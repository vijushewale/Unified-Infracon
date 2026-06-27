import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Middleware for JSON parsing
app.use(express.json());

// Initialize Gemini client (server-side only)
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// Helper: Extract bearer token from Authorization header
const getAuthToken = (req: express.Request): string | null => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.substring(7);
};

// API: Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

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
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: "The name of the person involved in the transaction. If no person is specified, leave empty.",
        },
        amount: {
          type: Type.NUMBER,
          description: "The numeric amount of the transaction. If amount is missing or not spoken, return null.",
        },
        date: {
          type: Type.STRING,
          description: `The date of the transaction in YYYY-MM-DD format. If a specific date is spoken (e.g. '26 May 2024'), parse it. If no date is spoken, default exactly to: ${currentLocalDate}.`,
        },
        type: {
          type: Type.STRING,
          description: "Whether money was 'Paid' (given/sent/dile/diye/spent/paid) or 'Received' (taken/got/ghetle/liye/received/gained). Must be exactly 'Paid' or 'Received'.",
        },
        description: {
          type: Type.STRING,
          description: "A short, descriptive note of what the transaction was for. E.g. 'Payment', 'Borrow', 'Return', etc. If nothing specific, use 'Voice Entry'.",
        },
        amountMissing: {
          type: Type.BOOLEAN,
          description: "Set to true if the transaction amount is not mentioned or missing in the text.",
        },
        detectedLanguage: {
          type: Type.STRING,
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

    const response = await ai.models.generateContent({
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

    const structuredData = JSON.parse(resultText.trim());
    res.json(structuredData);
  } catch (error: any) {
    console.error("Gemini Parsing Error:", error);
    res.status(500).json({ error: error.message || "Failed to parse voice text with Gemini" });
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
      const appendHeaderUrl = `https://sheets.googleapis.com/v4/spreadsheets/${file.id}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED`;
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

    const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED`;
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
    const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:F500`;
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
    // 1. Get current rows to find row count and find Sheet ID
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
    const metaRes = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!metaRes.ok) {
      throw new Error("Failed to fetch spreadsheet metadata");
    }

    const metaData: any = await metaRes.json();
    const sheetId = metaData.sheets?.[0]?.properties?.sheetId ?? 0;

    const dataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:F500`;
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
