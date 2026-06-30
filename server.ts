import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Middleware for JSON parsing
app.use(express.json());

// Initialize Gemini client lazily (server-side only)
let ai: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!ai) {
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return ai;
}

// Helper: Extract bearer token from Authorization header
const getAuthToken = (req: express.Request): string | null => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.substring(7);
};

// Helper: Get properties of the first worksheet dynamically to handle localization and renaming
async function getFirstSheetProperties(spreadsheetId: string, token: string): Promise<{ sheetId: number; title: string }> {
  try {
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`;
    const metaRes = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!metaRes.ok) {
      const errText = await metaRes.text();
      console.warn(`Failed to fetch spreadsheet metadata, falling back to Sheet1: ${errText}`);
      return { sheetId: 0, title: "Sheet1" };
    }

    const metaData: any = await metaRes.json();
    const firstSheet = metaData.sheets?.[0]?.properties;
    if (!firstSheet) {
      console.warn("No worksheets found in metadata, falling back to Sheet1");
      return { sheetId: 0, title: "Sheet1" };
    }

    return {
      sheetId: firstSheet.sheetId ?? 0,
      title: firstSheet.title || "Sheet1",
    };
  } catch (error) {
    console.error("Error in getFirstSheetProperties, falling back to Sheet1:", error);
    return { sheetId: 0, title: "Sheet1" };
  }
}

// API: Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Helper to convert Devanagari numerals to standard Western digits
function convertDevanagariNumerals(text: string): string {
  const devanagariDigits = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];
  return text.split('').map(char => {
    const idx = devanagariDigits.indexOf(char);
    return idx !== -1 ? String(idx) : char;
  }).join('');
}

// Ultra-robust amount extractor from mixed language/spoken text
function extractAmountFromText(text: string): number | null {
  const cleanText = convertDevanagariNumerals(text).toLowerCase();
  const words = cleanText.split(/[\s,।.?!]+/);

  const numberMap: { [key: string]: number } = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
    "ek": 1, "do": 2, "don": 2, "teen": 3, "char": 4, "paach": 5, "pach": 5, "saha": 6, "saat": 7, "aath": 8, "nau": 9, "no": 9, "das": 10, "dah": 10,
    "vis": 20, "bees": 20, "tees": 30, "chalis": 40, "pannas": 50,
    "एक": 1, "दोन": 2, "तीन": 3, "चार": 4, "पाच": 5, "सहा": 6, "सात": 7, "आठ": 8, "नऊ": 9, "दहा": 10,
    "वीस": 20, "तीस": 30, "चाळीस": 40, "पन्नास": 50, "शंभर": 100, "सौ": 100, "sau": 100, "so": 100
  };

  const multipliers: { [key: string]: number } = {
    "thousand": 1000, "hazar": 1000, "hazaar": 1000, "हजार": 1000,
    "hundred": 100, "shambhar": 100, "शंभर": 100, "सौ": 100,
    "lakh": 100000, "lakha": 100000, "lac": 100000, "लाख": 100000
  };

  let currentVal = 0;
  let totalVal = 0;
  let foundAny = false;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    if (/^\d+(\.\d+)?$/.test(word)) {
      const num = parseFloat(word);
      currentVal = num;
      foundAny = true;
      continue;
    }

    if (numberMap[word] !== undefined) {
      currentVal += numberMap[word];
      foundAny = true;
      continue;
    }

    if (multipliers[word] !== undefined) {
      const mult = multipliers[word];
      if (currentVal === 0) {
        currentVal = 1;
      }
      totalVal += currentVal * mult;
      currentVal = 0;
      foundAny = true;
      continue;
    }
  }

  totalVal += currentVal;

  if (foundAny && totalVal > 0) {
    return totalVal;
  }

  const digits = cleanText.match(/\d+(\.\d+)?/);
  if (digits) {
    return parseFloat(digits[0]);
  }

  return null;
}

// Ultra-robust rule-based fallback parser for English, Hindi, and Marathi transactions
function parseVoiceFallback(text: string, currentLocalDate: string): any {
  const cleanText = convertDevanagariNumerals(text).toLowerCase();

  // 1. Detect language
  let detectedLanguage = "English";
  const marathiClues = ["dile", "ghetle", "rupaye", "rupaya", "rupya", "dila", "ghetla", "ale", "ala", "दिले", "घेतले", "रुपये", "रुपया", "आले", "मिळाले", "ला"];
  const hindiClues = ["diye", "liye", "diya", "liya", "rupay", "rupee", "ko", "ne", "mili", "mila", "mile", "दिए", "लिए", "दिया", "लिया", "रुपए", "रुपया", "मिले", "मिला", "को"];
  
  const marathiScore = marathiClues.filter(clue => cleanText.includes(clue)).length;
  const hindiScore = hindiClues.filter(clue => cleanText.includes(clue)).length;

  if (marathiScore > 0 && marathiScore >= hindiScore) {
    detectedLanguage = "Marathi";
  } else if (hindiScore > 0 && hindiScore > marathiScore) {
    detectedLanguage = "Hindi";
  } else if (/[\u0900-\u097F]/.test(text)) {
    detectedLanguage = "Marathi";
  }

  // 2. Extract Type (Paid vs Received)
  let type: "Paid" | "Received" = "Paid"; // Default
  const paidWords = ["paid", "spent", "gave", "sent", "send", "transfer", "pay", "given", "dile", "dilya", "dilele", "dila", "dele", "deun", "दिले", "दिला", "द्या", "पाठवले", "diye", "diya", "de", "diye hai", "दिए", "दिया", "भेजा", "dileli"];
  const receivedWords = ["received", "got", "took", "taken", "gained", "earn", "credit", "credited", "deposit", "ghetle", "ghetla", "ale", "ala", "ghetale", "मिळाले", "घेतले", "घेतला", "आले", "liye", "liya", "mile", "mila", "mili", "प्राप्त", "लिए", "लिया", "मिले", "मिला", "milale"];

  let paidScore = paidWords.filter(word => cleanText.includes(word)).length;
  let receivedScore = receivedWords.filter(word => cleanText.includes(word)).length;

  if (receivedScore > paidScore) {
    type = "Received";
  }

  // 3. Extract Amount using our robust helper
  const amount = extractAmountFromText(text);

  // 4. Extract Name
  const stopWords = new Set([
    "i", "you", "he", "she", "they", "we", "paid", "received", "spent", "gave", "sent", "send", "transfer", "pay", "given",
    "dile", "dilya", "dilele", "dila", "dele", "deun", "दिले", "दिला", "द्या", "पाठवले", "diye", "diya", "de", "diye hai", "दिए", "दिया", "भेजा",
    "received", "got", "took", "taken", "gained", "earn", "credit", "credited", "deposit", "ghetle", "ghetla", "ale", "ala", "ghetale",
    "मिळाले", "घेतले", "घेतला", "आले", "liye", "liya", "mile", "mila", "mili", "प्राप्त", "लिए", "लिया", "मिले", "मिला",
    "rupaye", "rupaya", "rupya", "rupay", "rupee", "rupees", "रुपये", "रुपया", "रुपए", "rs", "inr",
    "la", "ko", "ne", "se", "laa", "koo", "ला", "को", "ने", "से", "for", "to", "from", "on", "in", "and", "a", "the",
    "last", "row", "delete", "remove", "add", "save", "yes", "no", "okay", "ok", "confirm", "with",
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "hundred", "thousand", "lakh", "lac",
    "एक", "दोन", "तीन", "चार", "पाच", "सहा", "सात", "आठ", "नऊ", "दहा", "शंभर", "हजार", "लाख"
  ]);

  const words = text.split(/[\s,।.?!]+/).filter(w => w.length > 0);
  let name = "";
  for (const w of words) {
    const wClean = w.toLowerCase();
    if (/\d/.test(wClean) || stopWords.has(wClean) || wClean.length <= 1) {
      continue;
    }
    let cleanName = w;
    if (cleanName.toLowerCase().endsWith("la") && cleanName.length > 4) {
      cleanName = cleanName.substring(0, cleanName.length - 2);
    }
    if (cleanName.toLowerCase().endsWith("ko") && cleanName.length > 4) {
      cleanName = cleanName.substring(0, cleanName.length - 2);
    }
    name = cleanName;
    break;
  }

  if (!name) {
    name = "Self";
  }

  return {
    name: name,
    amount: amount,
    date: currentLocalDate,
    type: type,
    description: "Voice Fallback",
    amountMissing: amount === null,
    detectedLanguage: detectedLanguage
  };
}

// API: Parse spoken natural language into structured JSON using Gemini
app.post("/api/parse-voice", async (req, res) => {
  try {
    const { text, todayDate } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Text input is required" });
    }

    const currentLocalDate = todayDate || new Date().toISOString().split("T")[0];

    // Define the JSON schema for the transaction
    const responseSchema = {
      type: "OBJECT",
      properties: {
        name: {
          type: "STRING",
          description: "The name of the person involved in the transaction. If no person is specified, leave empty.",
        },
        amount: {
          type: "NUMBER",
          description: "The numeric amount of the transaction. If amount is missing or not spoken, return null.",
        },
        date: {
          type: "STRING",
          description: `The date of the transaction in YYYY-MM-DD format. If a specific date is spoken (e.g. '26 May 2024'), parse it. If no date is spoken, default exactly to: ${currentLocalDate}.`,
        },
        type: {
          type: "STRING",
          description: "Whether money was 'Paid' (given/sent/dile/diye/spent/paid) or 'Received' (taken/got/ghetle/liye/received/gained). Must be exactly 'Paid' or 'Received'.",
        },
        description: {
          type: "STRING",
          description: "A short, descriptive note of what the transaction was for. E.g. 'Payment', 'Borrow', 'Return', etc. If nothing specific, use 'Voice Entry'.",
        },
        amountMissing: {
          type: "BOOLEAN",
          description: "Set to true if the transaction amount is not mentioned or missing in the text.",
        },
        detectedLanguage: {
          type: "STRING",
          description: "The language detected in the input (e.g., 'Marathi', 'Hindi', 'English', 'Mixed').",
        }
      },
      required: ["name", "amount", "date", "type", "description", "amountMissing", "detectedLanguage"]
    };

    const systemInstruction = `
      You are an expert multilingual voice ledger assistant.
      Your task is to parse spoken transactions in English, Hindi, Marathi, or mixed languages (e.g. Hinglish, Marathinglish) into structured transaction data.
      Today's reference local date is: ${currentLocalDate}.
      
      Parsing rules:
      - Recognize person names (e.g., Rajesh, Mahesh, Suresh, Anita, Mom, Papa).
      - Correctly identify amounts from spoken words (e.g. 'five thousand', '5000', 'pach hajar', 'paach hajaar', 'panas rupaye').
      - Understand transaction direction:
        - "Paid" clues: dile, diye, spent, paid, send, transfer, diya, payment ki, kharch kele.
        - "Received" clues: ghetle, liye, received, got, deposit, credit, aale, payment received.
      - Default to today's date (${currentLocalDate}) if no date is mentioned.
      - Ensure amountMissing is true if no number/amount is detected.
    `;

    const prompt = `Analyze this spoken text and return structured JSON: "${text}"`;

    let structuredData;
    const client = getGeminiClient();
    if (!client) {
      console.warn("GEMINI_API_KEY is not defined. Running robust rule-based fallback parser.");
      structuredData = parseVoiceFallback(text, currentLocalDate);
    } else {
      try {
        const response = await client.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema,
            temperature: 0.1,
          },
        });

        const resultText = response.text;
        if (!resultText) {
          throw new Error("Empty response from Gemini model");
        }
        structuredData = JSON.parse(resultText.trim());
      } catch (geminiError: any) {
        console.warn("Gemini parsing failed or quota exceeded, running fallback parser:", geminiError);
        // Run the robust Indian-languages regex/rule-based parser
        structuredData = parseVoiceFallback(text, currentLocalDate);
      }
    }

    res.json(structuredData);
  } catch (error: any) {
    console.error("Gemini/Fallback Parsing Error:", error);
    res.status(500).json({ error: error.message || "Failed to parse voice text" });
  }
});

// API: Ensure Google Spreadsheet "Unified Infracon" exists in user's Drive, or create it.
app.post("/api/sheets/ensure-sheet", async (req, res) => {
  const token = getAuthToken(req);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized. Missing Google OAuth Token." });
  }

  try {
    // 1. Search for a file named "Unified Infracon" that is a spreadsheet
    const searchQuery = encodeURIComponent("name = 'Unified Infracon' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false");
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${searchQuery}&fields=files(id,name,webViewLink)`;

    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!searchRes.ok) {
      const errText = await searchRes.text();
      throw new Error(`Drive search failed: ${errText}`);
    }

    const searchData: any = await searchRes.json();
    let file = searchData.files && searchData.files[0];

    let newlyCreated = false;

    // 2. If not found, create a new spreadsheet
    if (!file) {
      const createRes = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Unified Infracon",
          mimeType: "application/vnd.google-apps.spreadsheet",
        }),
      });

      if (!createRes.ok) {
        const errText = await createRes.text();
        throw new Error(`Spreadsheet creation failed: ${errText}`);
      }

      file = await createRes.json();
      newlyCreated = true;

      // 3. Initialize with headers
      const props = await getFirstSheetProperties(file.id, token);
      const appendHeaderUrl = `https://sheets.googleapis.com/v4/spreadsheets/${file.id}/values/${encodeURIComponent(props.title)}!A1:append?valueInputOption=USER_ENTERED`;
      const headerRes = await fetch(appendHeaderUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          values: [
            ["Date", "Person Name", "Amount", "Type", "Description", "Created Time"],
          ],
        }),
      });

      if (!headerRes.ok) {
        console.error("Failed to append headers to new sheet", await headerRes.text());
      }
    }

    res.json({
      spreadsheetId: file.id,
      name: file.name,
      url: file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}/edit`,
      newlyCreated,
    });
  } catch (error: any) {
    console.error("Ensure Sheet Error:", error);
    res.status(500).json({ error: error.message || "Failed to find or create Google Sheet" });
  }
});

// API: Append transaction row to Google Spreadsheet
app.post("/api/sheets/append", async (req, res) => {
  const token = getAuthToken(req);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized. Missing Google OAuth Token." });
  }

  const { spreadsheetId, transaction } = req.body;
  if (!spreadsheetId || !transaction) {
    return res.status(400).json({ error: "spreadsheetId and transaction object are required" });
  }

  try {
    const { date, name, amount, type, description } = transaction;
    const createdTime = new Date().toLocaleString();

    const props = await getFirstSheetProperties(spreadsheetId, token);
    const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(props.title)}!A1:append?valueInputOption=USER_ENTERED`;
    const appendRes = await fetch(appendUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        values: [
          [date || "", name || "Self", amount || 0, type || "Paid", description || "Voice Entry", createdTime],
        ],
      }),
    });

    if (!appendRes.ok) {
      const errText = await appendRes.text();
      throw new Error(`Google Sheets append failed: ${errText}`);
    }

    res.json({ success: true, message: "Transaction saved successfully" });
  } catch (error: any) {
    console.error("Append Error:", error);
    res.status(500).json({ error: error.message || "Failed to append to spreadsheet" });
  }
});

// API: List entries from Google Spreadsheet
app.get("/api/sheets/list", async (req, res) => {
  const token = getAuthToken(req);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized. Missing Google OAuth Token." });
  }

  const { spreadsheetId } = req.query;
  if (!spreadsheetId) {
    return res.status(400).json({ error: "spreadsheetId query parameter is required" });
  }

  try {
    const props = await getFirstSheetProperties(spreadsheetId as string, token);
    const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(props.title)}!A1:F500`;
    const getRes = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!getRes.ok) {
      const errText = await getRes.text();
      throw new Error(`Google Sheets fetch failed: ${errText}`);
    }

    const data: any = await getRes.json();
    const rows = data.values || [];

    if (rows.length === 0) {
      return res.json({ entries: [] });
    }

    // Parse rows, skipping header row (index 0)
    const entries = rows.slice(1).map((row: any, idx: number) => ({
      rowNumber: idx + 2, // 1-based index including header
      date: row[0] || "",
      name: row[1] || "",
      amount: parseFloat(row[2]) || 0,
      type: row[3] || "Paid",
      description: row[4] || "",
      createdTime: row[5] || "",
    })).reverse(); // Return newest first

    res.json({ entries });
  } catch (error: any) {
    console.error("List Error:", error);
    res.status(500).json({ error: error.message || "Failed to read spreadsheet data" });
  }
});

// API: Delete last entry from Google Spreadsheet
app.post("/api/sheets/delete-last", async (req, res) => {
  const token = getAuthToken(req);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized. Missing Google OAuth Token." });
  }

  const { spreadsheetId } = req.body;
  if (!spreadsheetId) {
    return res.status(400).json({ error: "spreadsheetId is required" });
  }

  try {
    // 1. Get current rows to find row count and find Sheet ID and Title dynamically
    const props = await getFirstSheetProperties(spreadsheetId, token);
    const sheetId = props.sheetId;

    const dataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(props.title)}!A1:F500`;
    const dataRes = await fetch(dataUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!dataRes.ok) {
      throw new Error("Failed to fetch spreadsheet values for deletion");
    }

    const data: any = await dataRes.json();
    const rows = data.values || [];

    if (rows.length <= 1) {
      return res.json({ success: false, message: "No transaction entries found to delete." });
    }

    const lastRowIndex = rows.length - 1; // 0-indexed index of last row in sheets grid

    // 2. batchUpdate to delete the last row
    const deleteUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
    const deleteRes = await fetch(deleteUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: lastRowIndex,
                endIndex: lastRowIndex + 1,
              },
            },
          },
        ],
      }),
    });

    if (!deleteRes.ok) {
      const errText = await deleteRes.text();
      throw new Error(`Google Sheets row deletion failed: ${errText}`);
    }

    res.json({ success: true, message: "Last entry deleted successfully" });
  } catch (error: any) {
    console.error("Delete Last Error:", error);
    res.status(500).json({ error: error.message || "Failed to delete last entry" });
  }
});

// Configure Vite or Static Files serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
