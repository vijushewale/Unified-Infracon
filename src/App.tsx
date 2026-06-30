import React, { useState, useEffect, useRef, useMemo } from "react";
import { 
  googleSignIn, 
  initAuth, 
  logout, 
  getAccessToken 
} from "./lib/firebase";
import { User } from "firebase/auth";
import { 
  Mic, 
  MicOff, 
  Database, 
  LogOut, 
  ArrowUpRight, 
  ArrowDownLeft, 
  FileSpreadsheet, 
  Trash2, 
  Search, 
  Download, 
  HelpCircle, 
  Sun, 
  Moon, 
  Check, 
  X, 
  RefreshCw, 
  FileText, 
  Volume2, 
  AlertCircle,
  ExternalLink,
  Users,
  UserPlus,
  Lock,
  User as UserIcon,
  Plus,
  Edit2,
  Save,
  Send
} from "lucide-react";
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  BarChart, 
  Bar, 
  Legend 
} from "recharts";

interface TransactionEntry {
  rowNumber: number;
  date: string;
  name: string;
  amount: number;
  type: "Paid" | "Received";
  description: string;
  createdTime: string;
}

interface ParsedTransaction {
  name: string;
  amount: number | null;
  date: string;
  type: "Paid" | "Received";
  description: string;
  amountMissing: boolean;
  detectedLanguage: string;
}

interface OfflineProfile {
  id: string;
  displayName: string;
  username: string;
  password?: string;
  role: string;
  avatarColor: string;
}

export default function App() {
  // Local/Offline Profile State
  const [profiles, setProfiles] = useState<OfflineProfile[]>(() => {
    const stored = localStorage.getItem("local_profiles_v4");
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {}
    }
    return [
      { id: "1", displayName: "Ganesh Hinge", username: "ganesh", password: "123", role: "", avatarColor: "bg-indigo-600" },
      { id: "2", displayName: "Avinash Choudhari", username: "avinash", password: "123", role: "", avatarColor: "bg-emerald-600" }
    ];
  });

  const [activeProfile, setActiveProfile] = useState<OfflineProfile | null>(() => {
    const stored = localStorage.getItem("active_profile");
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {}
    }
    return null;
  });

  // Sheets Config State
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(() => localStorage.getItem("sheet_id"));
  const [sheetUrl, setSheetUrl] = useState<string | null>(() => localStorage.getItem("sheet_url"));
  const [isEnsuringSheet, setIsEnsuringSheet] = useState(false);
  const [entries, setEntries] = useState<TransactionEntry[]>([]);
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);

  // Auth State (Dynamic to allow Google Sheets sync)
  const [user, setUser] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const needsAuth = !activeProfile;
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(() => {
    const val = localStorage.getItem("is_offline_mode");
    return val === "false" ? false : true;
  });

  // Sync offline mode preference
  useEffect(() => {
    localStorage.setItem("is_offline_mode", String(isOfflineMode));
  }, [isOfflineMode]);

  // Initialize Google Auth connection
  useEffect(() => {
    const unsubscribe = initAuth(
      (googleUser: any, googleToken: string) => {
        setUser(googleUser);
        setToken(googleToken);
        const mode = localStorage.getItem("is_offline_mode");
        if (mode === "false") {
          fetchSheetEntries(false, googleToken, spreadsheetId);
        }
      },
      () => {
        setUser(null);
        setToken(null);
      }
    );
    return () => unsubscribe();
  }, [spreadsheetId]);

  // Recognition / Voice State
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [lastTranscript, setLastTranscript] = useState("");
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  // Speech / AI Parsed State
  const [parsedTransaction, setParsedTransaction] = useState<ParsedTransaction | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [assistantText, setAssistantText] = useState("Hi! I'm your Unified Infracon Assistant. Click the mic and speak a transaction in English, Hindi, or Marathi!");
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // Simulated Voice Text input (for testing if mic is not allowed/blocked inside AI Studio preview iframe)
  const [simulatedText, setSimulatedText] = useState("");

  // Confirmation dialog details
  const [waitingForConfirmation, setWaitingForConfirmation] = useState(false);

  // Voice Language selection & Auto-Submit preferences
  const [voiceLang, setVoiceLang] = useState<string>(() => localStorage.getItem("voice_lang") || "mr-IN");
  const [autoSubmit, setAutoSubmit] = useState<boolean>(() => {
    const val = localStorage.getItem("auto_submit");
    return val === null ? true : val === "true";
  });

  // Sync settings to localStorage
  useEffect(() => {
    localStorage.setItem("voice_lang", voiceLang);
  }, [voiceLang]);

  useEffect(() => {
    localStorage.setItem("auto_submit", String(autoSubmit));
  }, [autoSubmit]);

  // UI state
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [filterType, setFilterType] = useState<"All" | "Paid" | "Received">("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [ledgerViewMode, setLedgerViewMode] = useState<"list" | "spreadsheet">("spreadsheet");
  const [editingCell, setEditingCell] = useState<{ createdTime: string; field: keyof TransactionEntry } | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [deleteConfirmRow, setDeleteConfirmRow] = useState<string | null>(null);
  const [showDeleteLastConfirm, setShowDeleteLastConfirm] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [successNotification, setSuccessNotification] = useState<string | null>(null);
  const [errorNotification, setErrorNotification] = useState<string | null>(null);

  // Manual input when amount is missing
  const [manualAmount, setManualAmount] = useState<string>("");

  // Credentials Login Form & Registration state
  const [loginMode, setLoginMode] = useState<"select" | "direct" | "register">("select");
  const [selectedProfileForPassword, setSelectedProfileForPassword] = useState<OfflineProfile | null>(null);
  const [inlinePassword, setInlinePassword] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");

  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileUsername, setNewProfileUsername] = useState("");
  const [newProfilePassword, setNewProfilePassword] = useState("");
  const [newProfileRole, setNewProfileRole] = useState("Accounts Manager");
  const [newProfileColor, setNewProfileColor] = useState("bg-indigo-600");

  // Sync local profiles to localStorage
  useEffect(() => {
    localStorage.setItem("local_profiles_v4", JSON.stringify(profiles));
  }, [profiles]);

  // Sync active local profile to localStorage
  useEffect(() => {
    if (activeProfile) {
      localStorage.setItem("active_profile", JSON.stringify(activeProfile));
    } else {
      localStorage.removeItem("active_profile");
    }
  }, [activeProfile]);

  // Sync spreadsheetId and sheetUrl to localStorage
  useEffect(() => {
    if (spreadsheetId) {
      localStorage.setItem("sheet_id", spreadsheetId);
    } else {
      localStorage.removeItem("sheet_id");
    }
  }, [spreadsheetId]);

  useEffect(() => {
    if (sheetUrl) {
      localStorage.setItem("sheet_url", sheetUrl);
    } else {
      localStorage.removeItem("sheet_url");
    }
  }, [sheetUrl]);

  // Fetch entries from local storage or Google Sheets
  const fetchSheetEntries = async (currentOfflineMode = isOfflineMode, currentToken = token, currentSheetId = spreadsheetId) => {
    setIsLoadingEntries(true);
    if (currentOfflineMode || !currentToken || !currentSheetId) {
      const stored = localStorage.getItem("offline_entries");
      if (stored) {
        try {
          setEntries(JSON.parse(stored));
        } catch (e) {
          setEntries([]);
        }
      } else {
        setEntries([]);
      }
      setIsLoadingEntries(false);
      return;
    }

    try {
      const res = await fetch(`/api/sheets/list?spreadsheetId=${currentSheetId}`, {
        headers: {
          Authorization: `Bearer ${currentToken}`,
        },
      });

      if (!res.ok) {
        throw new Error("Failed to fetch ledger rows from Google Sheet");
      }

      const data = await res.json();
      if (data.entries) {
        setEntries(data.entries);
        localStorage.setItem("offline_entries", JSON.stringify(data.entries)); // Cache entries offline too
      }
    } catch (err: any) {
      console.error("Fetch Sheet Entries Error:", err);
      showError("Failed to fetch from Google Sheets. Using local backup.");
      const stored = localStorage.getItem("offline_entries");
      if (stored) {
        try {
          setEntries(JSON.parse(stored));
        } catch (e) {}
      }
    } finally {
      setIsLoadingEntries(false);
    }
  };

  // Handle cell save from inline edit in spreadsheet view
  const handleCellSave = (createdTime: string, field: keyof TransactionEntry, value: string) => {
    const updatedEntries = entries.map(e => {
      if (e.createdTime === createdTime) {
        const updated = { ...e };
        if (field === "amount") {
          const num = parseFloat(value);
          updated.amount = isNaN(num) ? 0 : num;
        } else if (field === "rowNumber") {
          const num = parseInt(value);
          updated.rowNumber = isNaN(num) ? updated.rowNumber : num;
        } else if (field === "type") {
          updated.type = value === "Received" ? "Received" : "Paid";
        } else {
          (updated as any)[field] = value;
        }
        return updated;
      }
      return e;
    });
    setEntries(updatedEntries);
    localStorage.setItem("offline_entries", JSON.stringify(updatedEntries));
    showSuccess("Cell updated!");
    setEditingCell(null);
  };

  // Add blank row directly into spreadsheet
  const handleAddBlankRow = () => {
    const newEntry: TransactionEntry = {
      rowNumber: entries.length + 1,
      date: new Date().toISOString().split("T")[0],
      name: "New Entry",
      amount: 0,
      type: "Paid",
      description: "Direct entry",
      createdTime: new Date().toLocaleDateString() + ", " + new Date().toLocaleTimeString(),
    };
    const updated = [newEntry, ...entries];
    setEntries(updated);
    localStorage.setItem("offline_entries", JSON.stringify(updated));
    showSuccess("Added blank row!");
    setEditingCell({ createdTime: newEntry.createdTime, field: "name" });
    setEditingValue("New Entry");
  };

  // Delete row by ID/createdTime
  const handleDeleteRow = (createdTime: string) => {
    const updated = entries.filter(e => e.createdTime !== createdTime);
    setEntries(updated);
    localStorage.setItem("offline_entries", JSON.stringify(updated));
    showSuccess("Row deleted!");
    if (deleteConfirmRow === createdTime) {
      setDeleteConfirmRow(null);
    }
  };

  const ensureGoogleSheet = async (authToken = token) => {
    if (!authToken) {
      showError("Please connect your Google Account first!");
      return;
    }
    setIsEnsuringSheet(true);
    try {
      const res = await fetch("/api/sheets/ensure-sheet", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || "Failed to find or create spreadsheet.");
      }

      const data = await res.json();
      setSpreadsheetId(data.spreadsheetId);
      setSheetUrl(data.url);
      showSuccess(data.newlyCreated ? "Created 'Unified Infracon' Spreadsheet!" : "Connected to Google Spreadsheet!");
      return data;
    } catch (err: any) {
      console.error(err);
      showError("Failed to configure Google Sheet: " + (err.message || "Unknown error"));
    } finally {
      setIsEnsuringSheet(false);
    }
  };

  // Google OAuth Handlers
  const handleGoogleSignIn = async () => {
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setToken(result.accessToken);
        showSuccess(`Google Sign-In successful!`);
        
        // Ensure Google Sheet exists or create it
        const sheetData = await ensureGoogleSheet(result.accessToken);
        
        // Disable offline mode to begin syncing
        setIsOfflineMode(false);
        localStorage.setItem("is_offline_mode", "false");
        
        if (sheetData) {
          fetchSheetEntries(false, result.accessToken, sheetData.spreadsheetId);
        }
      }
    } catch (err: any) {
      console.error(err);
      showError("Google Sign-In failed or was closed.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogoutGoogle = async () => {
    await logout();
    setUser(null);
    setToken(null);
    setIsOfflineMode(true);
    localStorage.setItem("is_offline_mode", "true");
    fetchSheetEntries(true, null, null);
    showSuccess("Google Sheets disconnected successfully.");
  };

  // Logout handler for local offline profile
  const handleLogout = async () => {
    setActiveProfile(null);
    localStorage.removeItem("active_profile");
    setEntries([]);
    showSuccess("Logged out successfully.");
  };

  // Fetch entries from local storage or Google Sheets on mount and when states change
  useEffect(() => {
    fetchSheetEntries();
  }, [activeProfile, isOfflineMode, token, spreadsheetId]);

  // Keep assistant instructions updated with latest state
  useEffect(() => {
    if (needsAuth) {
      setAssistantText("Please sign in with your Username & Password to access the Unified Infracon ledger.");
    } else if (parsedTransaction) {
      if (parsedTransaction.amountMissing) {
        setAssistantText(`I understood: "${parsedTransaction.name || "Self"}" transaction but the amount is missing. Please enter or speak the amount.`);
      } else {
        setAssistantText(`I understood: ${parsedTransaction.type} ${parsedTransaction.amount} to/from ${parsedTransaction.name || "Self"} on ${parsedTransaction.date}. Should I save? Speak 'Yes' or click Save.`);
      }
    } else {
      setAssistantText("Click the microphone and speak naturally! E.g. 'Paid Rajesh five thousand rupees' or 'Rajesh ko panchtas rupaye diye' or 'Mahesh kadun sat hajar ghetle'.");
    }
  }, [needsAuth, parsedTransaction]);

  // Trigger TTS voice response
  const speak = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    
    // Stop any ongoing speech
    window.speechSynthesis.cancel();

    // Check language patterns in text to select voice
    let lang = "en-US";
    if (text.includes("यशस्वीरित्या") || text.includes("झाले") || text.includes("रुपये") || text.includes("माहिती") || text.includes("सेंड") || text.includes("झाला") || text.includes("डेटा")) {
      lang = "mr-IN";
    } else if (text.includes("सफलतापूर्वक") || text.includes("सहेज") || text.includes("दिए") || text.includes("रुपए")) {
      lang = "hi-IN";
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 0.95;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  // Toast Helpers
  const showSuccess = (msg: string) => {
    setSuccessNotification(msg);
    setTimeout(() => setSuccessNotification(null), 4000);
  };

  const showError = (msg: string) => {
    setErrorNotification(msg);
    setTimeout(() => setErrorNotification(null), 5000);
  };

  // Web Speech Recognition Setup
  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const startListening = () => {
    setRecognitionError(null);
    setTranscript("");

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setRecognitionError("Speech recognition is not supported in this browser. Please type your phrase below.");
      return;
    }

    try {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = voiceLang; // Configured speech language: mr-IN, hi-IN, or en-IN

      rec.onstart = () => {
        setIsListening(true);
        speak(""); // Interrupt any current speech
      };

      rec.onresult = (event: any) => {
        const resultText = event.results[0][0].transcript;
        setTranscript(resultText);
        setLastTranscript(resultText);
        handleVoiceInputParsed(resultText);
      };

      rec.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === "not-allowed") {
          setRecognitionError("Microphone permission denied. Use simulated typing below to test!");
        } else {
          setRecognitionError(`Speech Recognition error: ${event.error}`);
        }
        setIsListening(false);
      };

      rec.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = rec;
      rec.start();
    } catch (err: any) {
      setRecognitionError("Failed to initiate microphone.");
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
  };

  // Core unified save transaction function
  const saveTransactionDirectly = async (tx: ParsedTransaction) => {
    setIsSaving(true);

    if (isOfflineMode || !token || !spreadsheetId) {
      try {
        const displayNameToUse = tx.name && tx.name !== "Self" ? tx.name : (activeProfile?.displayName || "Self");
        const newEntry: TransactionEntry = {
          rowNumber: entries.length + 1,
          date: tx.date || new Date().toISOString().split("T")[0],
          name: displayNameToUse,
          amount: tx.amount,
          type: tx.type,
          description: tx.description || "Local Entry",
          createdTime: new Date().toLocaleDateString() + ", " + new Date().toLocaleTimeString(),
        };
        const updatedEntries = [newEntry, ...entries];
        setEntries(updatedEntries);
        localStorage.setItem("offline_entries", JSON.stringify(updatedEntries));

        showSuccess(`Transaction saved locally!`);
        
        // Voice feedback
        let feedback = "";
        if (tx.detectedLanguage === "Marathi" || voiceLang === "mr-IN") {
          feedback = `डेटा यशस्वीपणे सेंड झाला आहे. ${displayNameToUse} साठी ${tx.amount} रुपये सेव्ह झाले.`;
        } else if (tx.detectedLanguage === "Hindi" || voiceLang === "hi-IN") {
          feedback = `डेटा सफलतापूर्वक सेंड हो गया है। ${displayNameToUse} के ${tx.amount} रुपये सहेज लिए गए हैं।`;
        } else {
          feedback = `Data sent successfully. Transaction of ${tx.amount} for ${displayNameToUse} saved.`;
        }
        speak(feedback);

        // Reset transaction states
        setParsedTransaction(null);
        setWaitingForConfirmation(false);
        setManualAmount("");
        setSimulatedText("");
        setLastTranscript("");
      } catch (err) {
        console.error("Local save error:", err);
        showError("Failed to save transaction locally.");
      } finally {
        setIsSaving(false);
      }
      return;
    }

    try {
      const res = await fetch("/api/sheets/append", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          spreadsheetId,
          transaction: tx,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to write to Google Sheets");
      }

      showSuccess(`Transaction saved to spreadsheet successfully!`);
      
      // Voice feedback
      let feedback = "";
      if (tx.detectedLanguage === "Marathi" || voiceLang === "mr-IN") {
        feedback = `डेटा यशस्वीपणे सेंड झाला आहे. ${tx.name || "व्यवहार"} साठी ${tx.amount} रुपये गुगल शीट मध्ये जोडले गेले आहेत.`;
      } else if (tx.detectedLanguage === "Hindi" || voiceLang === "hi-IN") {
        feedback = `डेटा सफलतापूर्वक सेंड हो गया है। ${tx.name || "लेनदेन"} के ${tx.amount} रुपये गुगल शीट में जोड दिए गए हैं।`;
      } else {
        feedback = `Data sent successfully. Transaction of ${tx.amount} saved to spreadsheet.`;
      }
      speak(feedback);

      // Reset transaction states
      setParsedTransaction(null);
      setWaitingForConfirmation(false);
      setManualAmount("");
      setSimulatedText("");
      setLastTranscript("");
      
      // Fetch fresh entries to update table
      fetchSheetEntries();
    } catch (err: any) {
      console.error(err);
      showError("Failed to save. Google Sheets permissions might have expired.");
    } finally {
      setIsSaving(false);
    }
  };

  // Handle parsing once we have clean text (either from speech recognition or simulation input)
  const handleVoiceInputParsed = async (textToParse: string) => {
    if (!textToParse || textToParse.trim().length === 0) return;

    // Clear the textbox input immediately so the user knows it has been sent
    setTranscript("");

    const lowerText = textToParse.toLowerCase().trim();

    // Voice Commands Parsing Engine
    if (waitingForConfirmation && parsedTransaction) {
      // User says yes, save, confirm
      if (
        lowerText.includes("yes") || 
        lowerText.includes("save") || 
        lowerText.includes("confirm") || 
        lowerText.includes("ho") || 
        lowerText.includes("haa") || 
        lowerText.includes("sahi hai") || 
        lowerText.includes("theek hai") || 
        lowerText.includes("कर") || 
        lowerText.includes("झाले")
      ) {
        handleSaveTransaction();
        return;
      }
      // User says no, cancel
      if (
        lowerText.includes("no") || 
        lowerText.includes("cancel") || 
        lowerText.includes("clear") || 
        lowerText.includes("nako") || 
        lowerText.includes("nahi") || 
        lowerText.includes("naka")
      ) {
        handleCancelTransaction();
        return;
      }
      // User says repeat
      if (lowerText.includes("repeat") || lowerText.includes("parat") || lowerText.includes("mhan") || lowerText.includes("bolo")) {
        triggerConfirmationSpeech(parsedTransaction);
        return;
      }
    }

    // General commands when not in active confirmation
    if (lowerText.includes("start listening") || lowerText.includes("mic on") || lowerText.includes("mike on")) {
      startListening();
      return;
    }
    if (lowerText.includes("stop listening") || lowerText.includes("mic off")) {
      stopListening();
      return;
    }
    if (lowerText.includes("open google sheet") || lowerText.includes("open sheet") || lowerText.includes("google sheet")) {
      if (sheetUrl) {
        window.open(sheetUrl, "_blank");
        speak("Opening Google Sheet ledger.");
      } else {
        speak("Google Sheet url is not ready yet.");
      }
      return;
    }
    if (lowerText.includes("delete last entry") || lowerText.includes("delete last")) {
      handleDeleteLastEntryWithVoicePrompt();
      return;
    }
    if (lowerText.includes("show today") || lowerText.includes("today's entries") || lowerText.includes("today entry")) {
      const todayString = new Date().toISOString().split("T")[0];
      setSearchQuery(todayString);
      speak("Showing today's entries.");
      return;
    }
    if (lowerText.includes("help") || lowerText.includes("madat")) {
      setShowHelpModal(true);
      speak("Opening ledger commands help.");
      return;
    }

    // Normal natural language transaction flow - Parse with Gemini!
    setIsParsing(true);
    setParsedTransaction(null);
    setWaitingForConfirmation(false);

    try {
      const res = await fetch("/api/parse-voice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: textToParse,
          todayDate: new Date().toISOString().split("T")[0],
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to analyze voice data with Gemini.");
      }

      const data: ParsedTransaction = await res.json();
      setParsedTransaction(data);

      if (data.amountMissing) {
        speak(data.detectedLanguage === "Marathi" 
          ? `मला ${data.name || "सेल्फ"} कडून व्यवहाराची माहिती मिळाली, पण रक्कम किती आहे?` 
          : data.detectedLanguage === "Hindi" 
            ? `${data.name || "सेल्फ"} के लेनदेन में राशि नहीं मिली। कृपया राशि दर्ज करें।` 
            : `Transaction found for ${data.name || "Self"} but the amount is missing. Please state the amount.`);
      } else {
        if (autoSubmit) {
          let autoMsg = "";
          if (data.detectedLanguage === "Marathi" || voiceLang === "mr-IN") {
            autoMsg = `व्यवहार मिळाला. गुगल शीट मध्ये थेट सेव्ह करत आहे.`;
          } else if (data.detectedLanguage === "Hindi" || voiceLang === "hi-IN") {
            autoMsg = `लेनदेन मिल गया है। इसे सीधे शीट में सहेज रहे हैं।`;
          } else {
            autoMsg = `Transaction recognized. Automatically saving to spreadsheet...`;
          }
          speak(autoMsg);
          await saveTransactionDirectly(data);
        } else {
          setWaitingForConfirmation(true);
          triggerConfirmationSpeech(data);
        }
      }
    } catch (err: any) {
      console.error(err);
      showError("Gemini analysis failed. Please try speaking again.");
    } finally {
      setIsParsing(false);
    }
  };

  // Speak Structured Confirmation back to User
  const triggerConfirmationSpeech = (tx: ParsedTransaction) => {
    let confirmPrompt = "";
    if (tx.detectedLanguage === "Marathi") {
      confirmPrompt = `मला समजले: नाव ${tx.name || "स्वतः"}, रक्कम ${tx.amount} रुपये, प्रकार ${tx.type === "Paid" ? "दिले" : "मिळाले"}, तारीख ${tx.date}. मी हे सेव्ह करू का?`;
    } else if (tx.detectedLanguage === "Hindi") {
      confirmPrompt = `मैंने समझा: नाम ${tx.name || "स्वयं"}, राशि ${tx.amount} रुपए, प्रकार ${tx.type === "Paid" ? "दिए" : "मिले"}, तारीख ${tx.date}। क्या मैं इसे सहेजूं?`;
    } else {
      confirmPrompt = `I understood: Name ${tx.name || "Self"}, Amount ${tx.amount}, Type ${tx.type}, Date ${tx.date}. Should I save?`;
    }
    speak(confirmPrompt);
  };

  // Voice trigger for delete last entry
  const handleDeleteLastEntryWithVoicePrompt = () => {
    setShowDeleteLastConfirm(true);
  };

  // Submit parsed transaction to Google Sheets or Local Storage if offline
  const handleSaveTransaction = async () => {
    if (!parsedTransaction) return;
    if (!isOfflineMode && (!token || !spreadsheetId)) return;
    
    // Check if amount is still missing
    if (parsedTransaction.amountMissing && !manualAmount) {
      showError("Please enter the transaction amount first!");
      speak("Rakkum sanga, please state or enter the amount.");
      return;
    }

    const amountValue = parsedTransaction.amountMissing ? parseFloat(manualAmount) : parsedTransaction.amount;
    if (amountValue === null || isNaN(amountValue || 0)) {
      showError("Invalid transaction amount.");
      return;
    }

    const transactionToSave = {
      ...parsedTransaction,
      amount: amountValue!,
    };

    await saveTransactionDirectly(transactionToSave);
  };

  // Abort currently parsed transaction
  const handleCancelTransaction = () => {
    setParsedTransaction(null);
    setWaitingForConfirmation(false);
    setManualAmount("");
    setSimulatedText("");
    setLastTranscript("");
    speak("Cancelled transaction.");
    showSuccess("Transaction discarded.");
  };

  // Delete last spreadsheet row or local entry
  const handleDeleteLastEntry = async () => {
    if (isOfflineMode) {
      if (entries.length === 0) {
        showError("No entries to delete.");
        speak("Nothing to delete.");
        return;
      }
      setIsSaving(true);
      try {
        const updatedEntries = entries.slice(1);
        setEntries(updatedEntries);
        localStorage.setItem("offline_entries", JSON.stringify(updatedEntries));
        showSuccess("Last local entry deleted successfully.");
        speak("Deleted last entry.");
      } catch (err) {
        console.error("Local delete error:", err);
        showError("Failed to delete local entry.");
      } finally {
        setIsSaving(false);
      }
      return;
    }

    if (!token || !spreadsheetId) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/sheets/delete-last", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          spreadsheetId,
        }),
      });

      const data = await res.json();
      if (data.success) {
        showSuccess("Last row deleted successfully from spreadsheet.");
        speak("Deleted last entry.");
        fetchSheetEntries();
      } else {
        showError(data.message || "Could not delete entry.");
        speak("Nothing to delete.");
      }
    } catch (err) {
      console.error(err);
      showError("Could not delete last row.");
    } finally {
      setIsSaving(false);
    }
  };

  // Trigger manual simulation typing parsing
  const triggerSimulationParse = () => {
    if (!simulatedText.trim()) return;
    handleVoiceInputParsed(simulatedText);
  };

  // CSV Export
  const handleDownloadCSV = () => {
    if (entries.length === 0) return;
    const headers = ["Date", "Person Name", "Amount", "Type", "Description", "Created Time"];
    const csvContent = [
      headers.join(","),
      ...entries.map(e => [
        `"${e.date}"`,
        `"${e.name}"`,
        e.amount,
        `"${e.type}"`,
        `"${e.description}"`,
        `"${e.createdTime}"`
      ].join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Voice_Ledger_Export_${new Date().toISOString().split("T")[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showSuccess("CSV Download started!");
  };

  // Aggregate Data for Stats & Charts
  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
      const matchesType = filterType === "All" || e.type === filterType;
      const matchesSearch = 
        e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.date.includes(searchQuery);
      return matchesType && matchesSearch;
    });
  }, [entries, filterType, searchQuery]);

  const stats = useMemo(() => {
    let todayPaid = 0;
    let todayReceived = 0;
    let monthlyPaid = 0;
    let monthlyReceived = 0;

    const todayStr = new Date().toISOString().split("T")[0];
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();

    entries.forEach(e => {
      const entryDate = new Date(e.date);
      const isToday = e.date === todayStr;
      const isThisMonth = entryDate.getMonth() === currentMonth && entryDate.getFullYear() === currentYear;

      if (e.type === "Paid") {
        if (isToday) todayPaid += e.amount;
        if (isThisMonth) monthlyPaid += e.amount;
      } else {
        if (isToday) todayReceived += e.amount;
        if (isThisMonth) monthlyReceived += e.amount;
      }
    });

    return {
      todayPaid,
      todayReceived,
      monthlyPaid,
      monthlyReceived,
      netToday: todayReceived - todayPaid,
      netMonthly: monthlyReceived - monthlyPaid,
    };
  }, [entries]);

  // Chart data: Group by last 7 transaction days
  const chartData = useMemo(() => {
    const datesMap: { [key: string]: { Paid: number; Received: number } } = {};
    
    // Get unique dates sorted
    entries.slice(0, 30).forEach(e => {
      if (!datesMap[e.date]) {
        datesMap[e.date] = { Paid: 0, Received: 0 };
      }
      if (e.type === "Paid") {
        datesMap[e.date].Paid += e.amount;
      } else {
        datesMap[e.date].Received += e.amount;
      }
    });

    return Object.keys(datesMap)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
      .map(date => ({
        date,
        Paid: datesMap[date].Paid,
        Received: datesMap[date].Received,
      }));
  }, [entries]);

  return (
    <div className={`min-h-screen font-sans transition-colors duration-300 ${
      theme === "dark" 
        ? "bg-slate-950 text-slate-100" 
        : "bg-slate-50 text-slate-800"
    }`}>
      {/* Toast Notifications */}
      {successNotification && (
        <div id="success-toast" className="fixed top-6 right-6 z-50 flex items-center gap-3 bg-emerald-600 text-white px-5 py-3 rounded-lg shadow-xl animate-bounce">
          <Check className="h-5 w-5" />
          <span className="font-medium">{successNotification}</span>
        </div>
      )}
      {errorNotification && (
        <div id="error-toast" className="fixed top-6 right-6 z-50 flex items-center gap-3 bg-rose-600 text-white px-5 py-3 rounded-lg shadow-xl animate-pulse">
          <AlertCircle className="h-5 w-5" />
          <span className="font-medium">{errorNotification}</span>
        </div>
      )}

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-4 py-6 md:px-8">
        {/* Top Navbar */}
        <header className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-8 pb-6 border-b border-slate-800/40">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-brand-orange text-white rounded-xl glow-orange">
              <Database className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-display font-bold tracking-tight text-brand-orange flex items-center gap-2">
                Unified Infracon
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                Vijay AI Smart Entry Ledger
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Secure Session Active Profile */}
            {activeProfile && (
              <div className="flex items-center gap-2 bg-brand-orange/10 border border-brand-orange/20 text-brand-orange text-xs px-3 py-1.5 rounded-xl font-semibold">
                <span className="h-2 w-2 bg-brand-orange rounded-full animate-pulse" />
                <span>Secure Ledger Session</span>
              </div>
            )}

            {/* Dark Mode toggle */}
            <button 
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 transition-all text-slate-600 dark:text-slate-300"
              title="Toggle Theme"
              id="theme-toggle-btn"
            >
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>

            {/* Help Button */}
            <button 
              onClick={() => setShowHelpModal(true)}
              className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 transition-all text-slate-600 dark:text-slate-300"
              title="Help & Commands"
              id="help-btn"
            >
              <HelpCircle className="h-5 w-5" />
            </button>

            {/* Google Sheets Live Link */}
            {sheetUrl && (
              <a 
                href={sheetUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600/10 text-emerald-600 hover:bg-emerald-600/20 border border-emerald-600/30 rounded-xl font-medium transition-all text-sm"
                title="View Google Sheet"
                id="view-sheet-btn"
              >
                <FileSpreadsheet className="h-4 w-4" />
                <span className="hidden md:inline">Open Spreadsheet</span>
              </a>
            )}

            {/* User Logged-in profile */}
            {user && (
              <div className="flex items-center gap-3 ml-2 pl-4 border-l border-slate-200 dark:border-slate-800">
                <img 
                  src={user.photoURL || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&q=80"} 
                  alt="Avatar" 
                  className="h-9 w-9 rounded-full ring-2 ring-brand-orange/40"
                  referrerPolicy="no-referrer"
                />
                <button 
                  onClick={handleLogout}
                  className="p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-all"
                  title="Logout"
                  id="logout-btn"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            )}

            {/* Offline Active Profile */}
            {isOfflineMode && activeProfile && (
              <div className="flex items-center gap-3 ml-2 pl-4 border-l border-slate-200 dark:border-slate-800">
                <div className={`h-9 w-9 rounded-full ${activeProfile.avatarColor} text-white flex items-center justify-center font-bold text-sm shadow-sm ring-2 ring-amber-500/40`}>
                  {activeProfile.displayName.charAt(0).toUpperCase()}
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-tight">
                    {activeProfile.displayName}
                  </p>
                  {activeProfile.role && (
                    <p className="text-[10px] text-slate-400 font-medium">
                      {activeProfile.role}
                    </p>
                  )}
                </div>
                <button 
                  onClick={() => {
                    setActiveProfile(null);
                    localStorage.removeItem("active_profile");
                    showSuccess("Logged out of local profile.");
                  }}
                  className="p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-all"
                  title="Switch Profile / Logout"
                  id="local-logout-btn"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Local Username and Password Authentication System */}
        {needsAuth ? (
          <div className="max-w-xl mx-auto my-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-3xl shadow-xl overflow-hidden transition-all duration-300">
            {/* Header banner */}
            <div className="bg-slate-900 dark:bg-slate-950 p-6 text-center border-b border-slate-800">
              <div className="p-3 bg-brand-orange/10 text-brand-orange rounded-2xl w-fit mx-auto mb-3">
                <Lock className="h-8 w-8 text-brand-orange" />
              </div>
              <h2 className="text-2xl font-display font-bold text-white">
                Unified Infracon Secure Ledger
              </h2>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Secure access to construction transactions & voice logs. Create or select a profile below to sign in.
              </p>
            </div>

            {/* Navigation Tabs */}
            <div className="flex border-b border-slate-100 dark:border-slate-800">
              <button
                onClick={() => {
                  setLoginMode("select");
                  setSelectedProfileForPassword(null);
                  setInlinePassword("");
                }}
                className={`w-1/3 py-3.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${
                  loginMode === "select"
                    ? "border-brand-orange text-brand-orange bg-slate-50/50 dark:bg-slate-900/50"
                    : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                }`}
              >
                Select Profile
              </button>
              <button
                onClick={() => {
                  setLoginMode("direct");
                  setUsernameInput("");
                  setPasswordInput("");
                }}
                className={`w-1/3 py-3.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${
                  loginMode === "direct"
                    ? "border-brand-orange text-brand-orange bg-slate-50/50 dark:bg-slate-900/50"
                    : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                }`}
              >
                Direct Login
              </button>
              <button
                onClick={() => {
                  setLoginMode("register");
                  setNewProfileName("");
                  setNewProfileUsername("");
                  setNewProfilePassword("");
                }}
                className={`w-1/3 py-3.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${
                  loginMode === "register"
                    ? "border-brand-orange text-brand-orange bg-slate-50/50 dark:bg-slate-900/50"
                    : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                }`}
              >
                Add User
              </button>
            </div>

            <div className="p-8">
              {loginMode === "select" && (
                <div className="space-y-6">
                  {!selectedProfileForPassword ? (
                    <>
                      <p className="text-xs text-slate-400 dark:text-slate-500 text-center font-mono uppercase tracking-wider">
                        Profiles Online (Click to enter password)
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        {profiles.map((prof) => (
                          <button
                            key={prof.id}
                            onClick={() => {
                              setSelectedProfileForPassword(prof);
                              setInlinePassword("");
                            }}
                            className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:scale-[1.02] text-left transition-all flex items-center gap-3.5"
                          >
                            <div className={`h-11 w-11 rounded-full ${prof.avatarColor} text-white flex items-center justify-center font-bold text-lg shadow-sm`}>
                              {prof.displayName.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-sm truncate">
                                {prof.displayName}
                              </h4>
                              {prof.role && (
                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                                  {prof.role}
                                </p>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    /* Password prompt for selected profile */
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const correctPassword = selectedProfileForPassword.password || "123";
                        if (inlinePassword === correctPassword) {
                          setActiveProfile(selectedProfileForPassword);
                          showSuccess(`Signed in as ${selectedProfileForPassword.displayName}!`);
                          setSelectedProfileForPassword(null);
                          setInlinePassword("");
                        } else {
                          showError("Incorrect password. Default is 123.");
                        }
                      }}
                      className="space-y-4"
                    >
                      <div className="text-center mb-4">
                        <div className={`h-16 w-16 rounded-full ${selectedProfileForPassword.avatarColor} text-white flex items-center justify-center font-bold text-2xl mx-auto shadow-md mb-2`}>
                          {selectedProfileForPassword.displayName.charAt(0).toUpperCase()}
                        </div>
                        <h3 className="font-semibold text-slate-800 dark:text-slate-200">
                          {selectedProfileForPassword.displayName}
                        </h3>
                        {selectedProfileForPassword.role && (
                          <p className="text-xs text-slate-400">{selectedProfileForPassword.role}</p>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5 font-mono">
                          Enter Password
                        </label>
                        <input
                          type="password"
                          placeholder="Password (Default is 123)"
                          value={inlinePassword}
                          onChange={(e) => setInlinePassword(e.target.value)}
                          className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-orange/50 text-sm transition-all"
                          autoFocus
                        />
                      </div>

                      <div className="flex gap-3 pt-2">
                        <button
                          type="button"
                          onClick={() => setSelectedProfileForPassword(null)}
                          className="w-1/2 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium rounded-xl transition-all text-sm"
                        >
                          Change Profile
                        </button>
                        <button
                          type="submit"
                          className="w-1/2 py-2.5 px-4 bg-brand-orange hover:bg-brand-orange/90 text-white font-medium rounded-xl shadow-md transition-all text-sm flex items-center justify-center gap-2"
                        >
                          <Check className="h-4 w-4" />
                          <span>Login</span>
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {loginMode === "direct" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!usernameInput.trim() || !passwordInput) {
                      showError("Please enter both username and password.");
                      return;
                    }
                    const userMatch = profiles.find(
                      (p) => p.username.toLowerCase() === usernameInput.trim().toLowerCase()
                    );
                    if (userMatch) {
                      const correctPassword = userMatch.password || "123";
                      if (passwordInput === correctPassword) {
                        setActiveProfile(userMatch);
                        showSuccess(`Signed in as ${userMatch.displayName}!`);
                        setUsernameInput("");
                        setPasswordInput("");
                      } else {
                        showError("Incorrect password.");
                      }
                    } else {
                      showError("User not found. Use 'Add User' tab to register.");
                    }
                  }}
                  className="space-y-4"
                >
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5 font-mono">
                      Username
                    </label>
                    <input
                      type="text"
                      placeholder="E.g. vijay"
                      value={usernameInput}
                      onChange={(e) => setUsernameInput(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-orange/50 text-sm transition-all"
                      autoFocus
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5 font-mono">
                      Password
                    </label>
                    <input
                      type="password"
                      placeholder="Password (Default: 123)"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-orange/50 text-sm transition-all"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-3 px-4 bg-brand-orange hover:bg-brand-orange/90 text-white font-medium rounded-xl shadow-md transition-all text-sm flex items-center justify-center gap-2"
                  >
                    <Check className="h-4 w-4" />
                    <span>Login</span>
                  </button>
                </form>
              )}

              {loginMode === "register" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newProfileName.trim()) {
                      showError("Please enter full name.");
                      return;
                    }
                    if (!newProfileUsername.trim()) {
                      showError("Please enter a username.");
                      return;
                    }
                    
                    const uName = newProfileUsername.trim().toLowerCase();
                    if (profiles.some((p) => p.username.toLowerCase() === uName)) {
                      showError("Username is already taken.");
                      return;
                    }

                    const newProfile: OfflineProfile = {
                      id: Date.now().toString(),
                      displayName: newProfileName.trim(),
                      username: uName,
                      password: newProfilePassword || "123",
                      role: newProfileRole,
                      avatarColor: newProfileColor,
                    };

                    const updated = [...profiles, newProfile];
                    setProfiles(updated);
                    setActiveProfile(newProfile);
                    
                    // Reset fields
                    setNewProfileName("");
                    setNewProfileUsername("");
                    setNewProfilePassword("");
                    
                    showSuccess(`Created account and signed in as ${newProfile.displayName}!`);
                  }}
                  className="space-y-4 text-left"
                >
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5 font-mono">
                      Full Name
                    </label>
                    <input
                      type="text"
                      placeholder="E.g. Sachin Kadam"
                      value={newProfileName}
                      onChange={(e) => setNewProfileName(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-orange/50 text-sm transition-all"
                      autoFocus
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5 font-mono">
                        Username
                      </label>
                      <input
                        type="text"
                        placeholder="E.g. sachin"
                        value={newProfileUsername}
                        onChange={(e) => setNewProfileUsername(e.target.value)}
                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-orange/50 text-sm transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5 font-mono">
                        Password
                      </label>
                      <input
                        type="password"
                        placeholder="Default: 123"
                        value={newProfilePassword}
                        onChange={(e) => setNewProfilePassword(e.target.value)}
                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-orange/50 text-sm transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5 font-mono">
                      Role / Designation
                    </label>
                    <select
                      value={newProfileRole}
                      onChange={(e) => setNewProfileRole(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-orange/50 text-sm transition-all"
                    >
                      <option value="Accounts Manager">Accounts Manager</option>
                      <option value="Client Representative">Client Representative</option>
                      <option value="Subcontractor">Subcontractor</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2 font-mono">
                      Avatar Color
                    </label>
                    <div className="flex gap-2.5">
                      {[
                        { class: "bg-indigo-600", label: "Indigo" },
                        { class: "bg-emerald-600", label: "Emerald" },
                        { class: "bg-rose-600", label: "Rose" },
                        { class: "bg-amber-600", label: "Amber" },
                        { class: "bg-cyan-600", label: "Cyan" },
                        { class: "bg-purple-600", label: "Purple" }
                      ].map((col) => (
                        <button
                          key={col.class}
                          type="button"
                          onClick={() => setNewProfileColor(col.class)}
                          className={`h-8 w-8 rounded-full ${col.class} flex items-center justify-center text-white font-bold transition-transform shadow-sm relative`}
                          title={col.label}
                        >
                          {newProfileColor === col.class && (
                            <Check className="h-4 w-4" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-3 px-4 bg-brand-orange hover:bg-brand-orange/90 text-white font-medium rounded-xl shadow-md transition-all text-sm flex items-center justify-center gap-2"
                  >
                    <Check className="h-4 w-4" />
                    <span>Create & Sign In</span>
                  </button>
                </form>
              )}
            </div>
            
            <div className="px-8 pb-8 pt-4 border-t border-slate-100 dark:border-slate-800 text-left bg-slate-50/50 dark:bg-slate-900/50">
              <h3 className="text-xs font-semibold font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                Supported Voice Languages
              </h3>
              <div className="grid grid-cols-3 gap-2 text-center text-xs text-slate-500 dark:text-slate-400 font-medium">
                <div className="bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200/50 dark:border-slate-800/50">
                  Marathi (मराठी)
                </div>
                <div className="bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200/50 dark:border-slate-800/50">
                  Hindi (हिंदी)
                </div>
                <div className="bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200/50 dark:border-slate-800/50">
                  English (US/UK/IN)
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Main Dashboard Workspace */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* Left Hand: Voice Entry Control Panel */}
            <section className="lg:col-span-5 flex flex-col gap-6">
              
              {/* Voice Interaction Glassmorphic Card */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/90 rounded-3xl p-6 shadow-xl relative overflow-hidden glow-orange">
                <div className="absolute top-0 right-0 w-32 h-32 bg-brand-orange/5 blur-3xl rounded-full pointer-events-none" />
                
                <h2 className="text-lg font-display font-semibold mb-4 text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Volume2 className="h-5 w-5 text-brand-orange" />
                  Voice Control Assistant
                </h2>

                {/* Voice Assistant Settings Panel */}
                <div className="bg-slate-50 dark:bg-slate-950/80 p-3.5 rounded-2xl border border-slate-200/50 dark:border-slate-800/80 mb-4 text-left">
                  <div className="mb-2.5">
                    <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block mb-1.5">
                      Select Speech Language / भाषा निवडा
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { code: "mr-IN", label: "मराठी (Marathi)" },
                        { code: "hi-IN", label: "हिंदी (Hindi)" },
                        { code: "en-IN", label: "English / Mix" }
                      ].map((lang) => (
                        <button
                          key={lang.code}
                          onClick={() => setVoiceLang(lang.code)}
                          className={`py-1.5 px-2 rounded-xl text-xs font-semibold transition-all border ${
                            voiceLang === lang.code
                              ? "bg-brand-orange/10 border-brand-orange text-brand-orange shadow-sm"
                              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                          }`}
                        >
                          {lang.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-200/50 dark:border-slate-800/50 pt-2.5 mt-2.5">
                    <div>
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                        Auto-Save to Spreadsheet
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 block">
                        थेट स्प्रेडशीट मध्ये सेव्ह करा (Direct send)
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={autoSubmit} 
                        onChange={(e) => setAutoSubmit(e.target.checked)} 
                        className="sr-only peer" 
                      />
                      <div className="w-9 h-5 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-brand-orange"></div>
                    </label>
                  </div>

                  {/* Google Sheets Sync Controller */}
                  <div className="border-t border-slate-200/50 dark:border-slate-800/50 pt-2.5 mt-2.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                          Google Sheets Sync Status
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block">
                          गुगल शीट मध्ये सिंक करा (Cloud Sync)
                        </span>
                      </div>
                      {token ? (
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={!isOfflineMode} 
                            onChange={(e) => {
                              const turnOnSheets = e.target.checked;
                              setIsOfflineMode(!turnOnSheets);
                              localStorage.setItem("is_offline_mode", String(!turnOnSheets));
                              fetchSheetEntries(!turnOnSheets, token, spreadsheetId);
                              if (turnOnSheets) {
                                showSuccess("Google Sheets Sync Active!");
                              } else {
                                showSuccess("Switched to Local Offline database.");
                              }
                            }} 
                            className="sr-only peer" 
                          />
                          <div className="w-9 h-5 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-emerald-600"></div>
                        </label>
                      ) : (
                        <span className="text-[10px] bg-slate-100 dark:bg-slate-900 text-slate-400 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-850 font-mono">
                          Offline
                        </span>
                      )}
                    </div>

                    {!token ? (
                      <button
                        onClick={handleGoogleSignIn}
                        disabled={isLoggingIn}
                        className="w-full mt-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all hover:scale-[1.01]"
                      >
                        <FileSpreadsheet className="h-4 w-4" />
                        <span>{isLoggingIn ? "Connecting Google..." : "Connect Google Sheets Ledger"}</span>
                      </button>
                    ) : (
                      <div className="bg-slate-100 dark:bg-slate-900 p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-[10px] space-y-1 text-slate-500 dark:text-slate-400">
                        <div className="flex justify-between">
                          <span>User: {user?.email || "Connected"}</span>
                          <button 
                            onClick={handleLogoutGoogle}
                            className="text-rose-500 hover:underline font-semibold"
                          >
                            Disconnect
                          </button>
                        </div>
                        {spreadsheetId ? (
                          <div className="flex justify-between items-center text-[9px] font-mono bg-white dark:bg-black p-1 px-1.5 rounded-lg border border-slate-150 dark:border-slate-850">
                            <span className="truncate max-w-[160px]">Sheet ID: {spreadsheetId}</span>
                            <button 
                              onClick={() => ensureGoogleSheet(token)}
                              disabled={isEnsuringSheet}
                              className="text-emerald-500 hover:underline font-semibold shrink-0"
                            >
                              {isEnsuringSheet ? "Syncing..." : "Re-sync"}
                            </button>
                          </div>
                        ) : (
                          <button 
                            onClick={() => ensureGoogleSheet(token)}
                            disabled={isEnsuringSheet}
                            className="w-full mt-1 py-1 px-2 bg-emerald-600/10 text-emerald-600 hover:bg-emerald-600/20 border border-emerald-600/25 rounded-lg font-semibold"
                          >
                            {isEnsuringSheet ? "Creating Sheet..." : "Create Spreadsheet"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Microphone Central Hub */}
                <div className="flex flex-col items-center py-6 text-center">
                  
                  {/* Wave Visualizer Effect */}
                  <div className="h-16 flex items-end justify-center gap-1.5 mb-6">
                    {isListening ? (
                      Array.from({ length: 9 }).map((_, idx) => (
                        <span 
                          key={idx} 
                          className="w-1.5 bg-gradient-to-t from-brand-orange to-amber-500 rounded-full wave-bar"
                          style={{
                            height: "100%",
                            animationDelay: `${idx * 0.15}s`
                          }}
                        />
                      ))
                    ) : (
                      <p className="text-xs font-mono text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                        Microphone Standing By
                      </p>
                    )}
                  </div>

                  {/* Mic Button */}
                  <button
                    onClick={toggleListening}
                    id="mic-trigger-btn"
                    className={`h-24 w-24 rounded-full flex items-center justify-center transition-all duration-300 relative group ${
                      isListening 
                        ? "bg-brand-orange text-white glow-orange-lg scale-105" 
                        : "bg-black border-2 border-slate-800 hover:border-brand-orange/50 text-slate-200 hover:text-brand-orange hover:scale-105"
                    }`}
                  >
                    {isListening ? (
                      <MicOff className="h-10 w-10 animate-pulse" />
                    ) : (
                      <Mic className="h-10 w-10 group-hover:animate-bounce" />
                    )}
                  </button>

                  <p className="mt-4 text-xs font-medium text-slate-500 dark:text-slate-400">
                    {isListening ? "Listening... Speak naturally" : "Click to start recording"}
                  </p>
                </div>

                {/* Assistant Text Dialogue Box */}
                <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-800/80 rounded-2xl mb-4 relative min-h-20 flex flex-col justify-center">
                  <p className="text-xs font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">
                    Voice Assistant
                  </p>
                  <p className="text-sm font-sans text-slate-700 dark:text-slate-300 font-medium leading-relaxed">
                    {assistantText}
                  </p>
                </div>

                {/* Real-time speech and manual text editor feed */}
                <div className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl mb-4 text-left">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold font-mono text-brand-orange uppercase tracking-wider flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5" />
                      Command Text / टाईप किंवा बोललेले मजकूर
                    </span>
                    {transcript && (
                      <button
                        onClick={() => setTranscript("")}
                        className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-semibold transition-all"
                      >
                        Clear / साफ करा
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={transcript}
                      onChange={(e) => setTranscript(e.target.value)}
                      placeholder="येथे टाईप करा किंवा माईक दाबून बोला... (E.g. राजेश ला ५००० रुपये दिले)"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange min-h-[64px] resize-none"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (transcript.trim() && !isParsing) {
                            handleVoiceInputParsed(transcript);
                          }
                        }
                      }}
                    />
                    <button
                      onClick={() => handleVoiceInputParsed(transcript)}
                      disabled={!transcript.trim() || isParsing}
                      className="w-full py-2.5 bg-brand-orange hover:bg-brand-orange/90 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5"
                    >
                      <Send className="h-3.5 w-3.5" />
                      डेटा पाठवा / Send Data
                    </button>
                  </div>
                </div>

                {/* Parsing / AI Processing Loader */}
                {isParsing && (
                  <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex flex-col items-center justify-center z-10">
                    <RefreshCw className="h-8 w-8 text-brand-orange animate-spin mb-2" />
                    <span className="text-xs font-semibold text-white">Gemini Extracting Ledger Data...</span>
                  </div>
                )}
              </div>

              {recognitionError && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/90 rounded-3xl p-5 shadow-lg">
                  <p className="text-xs text-amber-500 font-medium flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {recognitionError}
                  </p>
                </div>
              )}

              {/* Confirmation details form / screen */}
              {parsedTransaction && (
                <div className="bg-white dark:bg-slate-900 border-2 border-brand-orange rounded-3xl p-6 shadow-xl relative overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
                  <h3 className="text-lg font-display font-semibold mb-4 text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Check className="h-5 w-5 text-emerald-500" />
                    Confirm Extraction
                  </h3>

                  <div className="grid grid-cols-2 gap-4 mb-5 text-sm bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-200/50 dark:border-slate-800/50 font-sans">
                    <div>
                      <span className="text-xs font-mono text-slate-400">Person Name</span>
                      <p className="font-semibold text-slate-900 dark:text-slate-50 text-base">
                        {parsedTransaction.name || "Self (स्वतः)"}
                      </p>
                    </div>

                    <div>
                      <span className="text-xs font-mono text-slate-400">Date</span>
                      <p className="font-semibold text-slate-900 dark:text-slate-50 text-base">
                        {parsedTransaction.date}
                      </p>
                    </div>

                    <div>
                      <span className="text-xs font-mono text-slate-400">Transaction Type</span>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold mt-1 ${
                        parsedTransaction.type === "Paid" 
                          ? "bg-rose-500/10 text-rose-500 border border-rose-500/20" 
                          : "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                      }`}>
                        {parsedTransaction.type === "Paid" ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownLeft className="h-3.5 w-3.5" />}
                        {parsedTransaction.type}
                      </span>
                    </div>

                    <div>
                      <span className="text-xs font-mono text-slate-400">Amount</span>
                      {parsedTransaction.amountMissing ? (
                        <div className="mt-1">
                          <input 
                            type="number"
                            value={manualAmount}
                            onChange={(e) => setManualAmount(e.target.value)}
                            placeholder="Enter Amount"
                            className="w-full bg-white dark:bg-slate-900 border border-brand-orange rounded-lg px-2.5 py-1 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-500 focus:outline-none"
                            id="manual-amount-input"
                          />
                        </div>
                      ) : (
                        <p className="font-semibold text-slate-900 dark:text-slate-50 text-base">
                          ₹ {parsedTransaction.amount}
                        </p>
                      )}
                    </div>

                    <div className="col-span-2 border-t border-slate-200/50 dark:border-slate-800/50 pt-3 mt-1">
                      <span className="text-xs font-mono text-slate-400">Description</span>
                      <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                        {parsedTransaction.description || "Voice Entry"}
                      </p>
                    </div>

                    <div className="col-span-2">
                      <span className="text-[10px] font-bold font-mono text-slate-400 uppercase">
                        AI Detected Language: {parsedTransaction.detectedLanguage}
                      </span>
                    </div>
                  </div>

                  {/* Confirmation Speech Action Guidance */}
                  {waitingForConfirmation && (
                    <p className="text-xs text-brand-orange font-semibold font-mono uppercase tracking-wider mb-4 animate-pulse text-center">
                      🔊 Say "Yes" or "Save" to commit
                    </p>
                  )}

                  {/* Manual Confirmation Buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={handleSaveTransaction}
                      disabled={isSaving}
                      className="flex-1 bg-brand-orange hover:bg-brand-orange-hover disabled:opacity-50 text-white rounded-xl py-3 text-sm font-semibold transition-all shadow-md flex items-center justify-center gap-2"
                      id="confirm-save-btn"
                    >
                      {isSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Save Transaction
                    </button>
                    <button
                      onClick={handleCancelTransaction}
                      disabled={isSaving}
                      className="flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 disabled:opacity-50 text-slate-700 dark:text-slate-200 rounded-xl py-3 text-sm font-semibold transition-all"
                      id="confirm-cancel-btn"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Right Hand: Dashboard Metrics, Charts & Activity ledger */}
            <section className="lg:col-span-7 flex flex-col gap-6">
              
              {/* Stats Bento Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                
                {/* Total Paid Card */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 shadow-md flex flex-col justify-between">
                  <div>
                    <span className="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider">
                      Today Paid
                    </span>
                    <h3 className="text-2xl md:text-3xl font-display font-bold text-rose-500 mt-1.5">
                      ₹ {stats.todayPaid}
                    </h3>
                  </div>
                  <div className="flex items-center justify-between text-xs font-mono text-slate-500 dark:text-slate-400 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/60">
                    <span>Month Paid</span>
                    <span className="font-semibold text-rose-500">₹{stats.monthlyPaid}</span>
                  </div>
                </div>

                {/* Total Received Card */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 shadow-md flex flex-col justify-between">
                  <div>
                    <span className="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider">
                      Today Received
                    </span>
                    <h3 className="text-2xl md:text-3xl font-display font-bold text-emerald-500 mt-1.5">
                      ₹ {stats.todayReceived}
                    </h3>
                  </div>
                  <div className="flex items-center justify-between text-xs font-mono text-slate-500 dark:text-slate-400 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/60">
                    <span>Month Recv</span>
                    <span className="font-semibold text-emerald-500">₹{stats.monthlyReceived}</span>
                  </div>
                </div>

                {/* Net Balance Card */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 shadow-md flex flex-col justify-between">
                  <div>
                    <span className="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider">
                      Net Today
                    </span>
                    <h3 className={`text-2xl md:text-3xl font-display font-bold mt-1.5 ${
                      stats.netToday >= 0 ? "text-emerald-500" : "text-rose-500"
                    }`}>
                      ₹ {stats.netToday}
                    </h3>
                  </div>
                  <div className="flex items-center justify-between text-xs font-mono text-slate-500 dark:text-slate-400 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/60">
                    <span>Net Month</span>
                    <span className={`font-semibold ${stats.netMonthly >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                      ₹{stats.netMonthly}
                    </span>
                  </div>
                </div>
              </div>

              {/* Recharts Graphical Chart */}
              {chartData.length > 0 && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-3xl p-5 shadow-lg">
                  <h3 className="text-sm font-display font-semibold mb-4 text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                    Ledger Trends (Recent Entries Breakdown)
                  </h3>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorPaid" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.2}/>
                            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorRecv" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === "dark" ? "#1e293b" : "#e2e8f0"} />
                        <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                        <Tooltip contentStyle={{ backgroundColor: theme === "dark" ? "#0f172a" : "#ffffff", borderColor: "#64748b" }} />
                        <Legend verticalAlign="top" height={36} iconType="circle" />
                        <Area type="monotone" dataKey="Paid" stroke="#f43f5e" strokeWidth={2.5} fillOpacity={1} fill="url(#colorPaid)" />
                        <Area type="monotone" dataKey="Received" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorRecv)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Activity Ledger Block */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-3xl p-6 shadow-xl">
                
                {/* Search, View Toggles & Action Header */}
                <div className="flex flex-col xl:flex-row justify-between items-stretch xl:items-center gap-4 mb-6">
                  <div>
                    <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <FileSpreadsheet className="h-5 w-5 text-brand-orange" />
                      <span>Ledger Spreadsheet</span>
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Total {filteredEntries.length} entries. Double-click any cell to edit directly!
                    </p>
                  </div>

                  {/* Toggle and Action Buttons */}
                  <div className="flex flex-wrap items-center gap-3">
                    {/* View Switcher */}
                    <div className="bg-slate-100 dark:bg-slate-950 p-1 border border-slate-200 dark:border-slate-800 rounded-xl flex">
                      <button
                        onClick={() => setLedgerViewMode("spreadsheet")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
                          ledgerViewMode === "spreadsheet"
                            ? "bg-brand-orange text-white shadow-sm"
                            : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
                        }`}
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                        <span>Spreadsheet</span>
                      </button>
                      <button
                        onClick={() => setLedgerViewMode("list")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
                          ledgerViewMode === "list"
                            ? "bg-brand-orange text-white shadow-sm"
                            : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
                        }`}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        <span>List View</span>
                      </button>
                    </div>

                    {/* Add blank row (Only for Spreadsheet Mode) */}
                    {ledgerViewMode === "spreadsheet" && (
                      <button
                        onClick={handleAddBlankRow}
                        className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1 transition-all shadow-sm"
                        title="Add New Empty Row"
                        id="add-blank-row-btn"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Add Row</span>
                      </button>
                    )}

                    {/* CSV Download Button */}
                    {entries.length > 0 && (
                      <button
                        onClick={handleDownloadCSV}
                        className="p-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl text-slate-600 dark:text-slate-300 transition-all border border-slate-200/50 dark:border-slate-800"
                        title="Download CSV"
                        id="download-csv-btn"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    )}

                    {/* Delete Last Row Button */}
                    {entries.length > 0 && (
                      <button
                        onClick={handleDeleteLastEntryWithVoicePrompt}
                        className="p-2.5 bg-slate-100 hover:bg-rose-500/10 dark:bg-slate-800 dark:hover:bg-rose-500/10 rounded-xl text-slate-600 dark:text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 transition-all border border-slate-200/50 dark:border-slate-800"
                        title="Delete Last Entry"
                        id="delete-last-btn"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}

                    {/* Refresh Button */}
                    <button
                      onClick={fetchSheetEntries}
                      disabled={isLoadingEntries}
                      className="p-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl text-slate-600 dark:text-slate-300 transition-all border border-slate-200/50 dark:border-slate-800"
                      title="Sync Ledger"
                      id="sync-ledger-btn"
                    >
                      <RefreshCw className={`h-4 w-4 ${isLoadingEntries ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 mb-5">
                  {/* Search Input */}
                  <div className="sm:col-span-7 relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input 
                      type="text"
                      placeholder="Search name, description, date..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-9 pr-4 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-brand-orange"
                      id="ledger-search-input"
                    />
                  </div>

                  {/* Filter Type Tabs */}
                  <div className="sm:col-span-5 bg-slate-50 dark:bg-slate-950 p-1 border border-slate-200 dark:border-slate-800 rounded-xl flex">
                    {(["All", "Paid", "Received"] as const).map(type => (
                      <button
                        key={type}
                        onClick={() => setFilterType(type)}
                        className={`flex-1 text-center py-1 rounded-lg text-xs font-semibold transition-all ${
                          filterType === type 
                            ? "bg-brand-orange text-white" 
                            : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Main Views Container */}
                {isLoadingEntries ? (
                  <div className="py-12 text-center">
                    <RefreshCw className="h-8 w-8 text-brand-orange animate-spin mx-auto mb-3" />
                    <span className="text-xs font-mono text-slate-400">Loading ledger logs...</span>
                  </div>
                ) : filteredEntries.length === 0 ? (
                  <div className="py-12 text-center border-2 border-dashed border-slate-200 dark:border-slate-800/80 rounded-2xl">
                    <p className="text-sm font-semibold text-slate-400 dark:text-slate-500">
                      No records found in this view.
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-600 mt-1">
                      Add entries via spoken natural voice commands or add row directly above!
                    </p>
                  </div>
                ) : ledgerViewMode === "spreadsheet" ? (
                  /* SPREADSHEET TAB GRID */
                  <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-2xl shadow-inner max-h-[500px]">
                    <table className="w-full text-left border-collapse min-w-[700px]">
                      <thead>
                        <tr className="bg-slate-100 dark:bg-slate-950 text-[11px] text-slate-400 dark:text-slate-500 font-mono tracking-wider border-b border-slate-200 dark:border-slate-800 select-none">
                          <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-800 text-center w-12">#</th>
                          <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-800">A: DATE (तारीख)</th>
                          <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-800">B: NAME (नाव)</th>
                          <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-800 w-32">C: TYPE (प्रकार)</th>
                          <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-800 w-36">D: AMOUNT (रक्कम ₹)</th>
                          <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-800">E: DESCRIPTION (माहिती)</th>
                          <th className="py-2.5 px-3 text-center w-16">DEL</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {filteredEntries.map((e, idx) => {
                          const isEditing = (field: keyof TransactionEntry) => 
                            editingCell?.createdTime === e.createdTime && editingCell?.field === field;

                          const startEdit = (field: keyof TransactionEntry, currentValue: string | number) => {
                            setEditingCell({ createdTime: e.createdTime, field });
                            setEditingValue(currentValue.toString());
                          };

                          return (
                            <tr key={e.createdTime || idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-950/40 text-xs text-slate-800 dark:text-slate-200 font-sans transition-all">
                              {/* Row Index */}
                              <td className="py-2 px-3 border-r border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 text-center font-mono font-medium text-slate-400 w-12">
                                {idx + 1}
                              </td>

                              {/* Date Cell */}
                              <td 
                                className="py-2 px-3 border-r border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-brand-orange/5 transition-all"
                                onDoubleClick={() => startEdit("date", e.date)}
                              >
                                {isEditing("date") ? (
                                  <input 
                                    type="date"
                                    value={editingValue}
                                    onChange={(evt) => setEditingValue(evt.target.value)}
                                    onBlur={() => handleCellSave(e.createdTime, "date", editingValue)}
                                    onKeyDown={(evt) => {
                                      if (evt.key === "Enter") handleCellSave(e.createdTime, "date", editingValue);
                                      if (evt.key === "Escape") setEditingCell(null);
                                    }}
                                    autoFocus
                                    className="w-full bg-white dark:bg-slate-800 border border-brand-orange rounded px-1.5 py-0.5 focus:outline-none font-sans text-slate-900 dark:text-slate-55"
                                  />
                                ) : (
                                  <span className="font-mono">{e.date}</span>
                                )}
                              </td>

                              {/* Name Cell */}
                              <td 
                                className="py-2 px-3 border-r border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-brand-orange/5 transition-all font-medium"
                                onDoubleClick={() => startEdit("name", e.name)}
                              >
                                {isEditing("name") ? (
                                  <input 
                                    type="text"
                                    value={editingValue}
                                    onChange={(evt) => setEditingValue(evt.target.value)}
                                    onBlur={() => handleCellSave(e.createdTime, "name", editingValue)}
                                    onKeyDown={(evt) => {
                                      if (evt.key === "Enter") handleCellSave(e.createdTime, "name", editingValue);
                                      if (evt.key === "Escape") setEditingCell(null);
                                    }}
                                    autoFocus
                                    className="w-full bg-white dark:bg-slate-800 border border-brand-orange rounded px-1.5 py-0.5 focus:outline-none text-slate-900 dark:text-slate-55"
                                  />
                                ) : (
                                  <span>{e.name || "Self"}</span>
                                )}
                              </td>

                              {/* Type Cell */}
                              <td 
                                className="py-2 px-3 border-r border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-brand-orange/5 transition-all"
                                onDoubleClick={() => startEdit("type", e.type)}
                              >
                                {isEditing("type") ? (
                                  <select
                                    value={editingValue}
                                    onChange={(evt) => {
                                      setEditingValue(evt.target.value);
                                      handleCellSave(e.createdTime, "type", evt.target.value);
                                    }}
                                    onBlur={() => handleCellSave(e.createdTime, "type", editingValue)}
                                    autoFocus
                                    className="w-full bg-white dark:bg-slate-800 border border-brand-orange rounded px-1.5 py-0.5 focus:outline-none text-slate-900 dark:text-slate-55 text-xs"
                                  >
                                    <option value="Paid">Paid</option>
                                    <option value="Received">Received</option>
                                  </select>
                                ) : (
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    e.type === "Paid" 
                                      ? "bg-rose-500/10 text-rose-500 border border-rose-500/20" 
                                      : "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                                  }`}>
                                    {e.type}
                                  </span>
                                )}
                              </td>

                              {/* Amount Cell */}
                              <td 
                                className="py-2 px-3 border-r border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-brand-orange/5 transition-all"
                                onDoubleClick={() => startEdit("amount", e.amount)}
                              >
                                {isEditing("amount") ? (
                                  <input 
                                    type="number"
                                    value={editingValue}
                                    onChange={(evt) => setEditingValue(evt.target.value)}
                                    onBlur={() => handleCellSave(e.createdTime, "amount", editingValue)}
                                    onKeyDown={(evt) => {
                                      if (evt.key === "Enter") handleCellSave(e.createdTime, "amount", editingValue);
                                      if (evt.key === "Escape") setEditingCell(null);
                                    }}
                                    autoFocus
                                    className="w-full bg-white dark:bg-slate-800 border border-brand-orange rounded px-1.5 py-0.5 focus:outline-none font-mono text-slate-900 dark:text-slate-55"
                                  />
                                ) : (
                                  <span className={`font-mono font-bold ${e.type === "Paid" ? "text-rose-500" : "text-emerald-500"}`}>
                                    ₹ {e.amount}
                                  </span>
                                )}
                              </td>

                              {/* Description Cell */}
                              <td 
                                className="py-2 px-3 border-r border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-brand-orange/5 transition-all text-slate-500 dark:text-slate-400"
                                onDoubleClick={() => startEdit("description", e.description)}
                              >
                                {isEditing("description") ? (
                                  <input 
                                    type="text"
                                    value={editingValue}
                                    onChange={(evt) => setEditingValue(evt.target.value)}
                                    onBlur={() => handleCellSave(e.createdTime, "description", editingValue)}
                                    onKeyDown={(evt) => {
                                      if (evt.key === "Enter") handleCellSave(e.createdTime, "description", editingValue);
                                      if (evt.key === "Escape") setEditingCell(null);
                                    }}
                                    autoFocus
                                    className="w-full bg-white dark:bg-slate-800 border border-brand-orange rounded px-1.5 py-0.5 focus:outline-none text-slate-900 dark:text-slate-55"
                                  />
                                ) : (
                                  <span>{e.description || "-"}</span>
                                )}
                              </td>

                              {/* Actions Column */}
                              <td className="py-2 px-3 text-center">
                                {deleteConfirmRow === e.createdTime ? (
                                  <div className="flex items-center justify-center gap-1.5 animate-fadeIn">
                                    <button
                                      onClick={() => handleDeleteRow(e.createdTime)}
                                      className="text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 hover:text-rose-500 px-1.5 py-0.5 rounded text-[10px] font-bold border border-rose-500/20 transition-all"
                                      title="Confirm Delete"
                                    >
                                      Yes
                                    </button>
                                    <button
                                      onClick={() => setDeleteConfirmRow(null)}
                                      className="text-slate-500 dark:text-slate-400 hover:bg-slate-500/10 px-1.5 py-0.5 rounded text-[10px] font-bold border border-slate-500/20 transition-all"
                                      title="Cancel"
                                    >
                                      No
                                    </button>
                                  </div>
                                ) : (
                                  <button 
                                    onClick={() => setDeleteConfirmRow(e.createdTime)}
                                    className="text-slate-400 hover:text-rose-500 p-1 rounded-md hover:bg-rose-500/10 transition-all"
                                    title="Delete Row"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  /* LIST VIEW MODE */
                  <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                    {filteredEntries.map((e, idx) => (
                      <div 
                        key={idx}
                        className="flex justify-between items-center bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-200/50 dark:border-slate-800/50 hover:border-brand-orange/40 transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <span className={`p-2.5 rounded-xl ${
                            e.type === "Paid" 
                              ? "bg-rose-500/10 text-rose-500" 
                              : "bg-emerald-500/10 text-emerald-500"
                          }`}>
                            {e.type === "Paid" ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownLeft className="h-5 w-5" />}
                          </span>
                          <div>
                            <h4 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                              {e.name || "Self"}
                            </h4>
                            <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                              <span>{e.date}</span>
                              <span className="h-1 w-1 bg-slate-300 dark:bg-slate-700 rounded-full" />
                              <span className="truncate max-w-40">{e.description || "Voice Entry"}</span>
                            </div>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className={`font-display font-bold text-base ${
                            e.type === "Paid" ? "text-rose-500" : "text-emerald-500"
                          }`}>
                            {e.type === "Paid" ? "-" : "+"} ₹{e.amount}
                          </span>
                          <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 mt-0.5">
                            {e.createdTime.split(", ")[1] || e.createdTime}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>

      {/* Help Modal */}
      {showHelpModal && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl relative glow-blue">
            <button 
              onClick={() => setShowHelpModal(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              id="close-help-btn"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-xl font-display font-bold mb-4 text-slate-900 dark:text-slate-100">
              Unified Infracon Commands Guide
            </h3>

            <div className="space-y-4 text-sm leading-relaxed max-h-96 overflow-y-auto">
              <div>
                <h4 className="font-semibold text-brand-orange">Speech Recognition Examples</h4>
                <p className="text-xs text-slate-500 mb-1.5">You can speak in English, Marathi, Hindi, or Mixed language:</p>
                <ul className="list-disc pl-5 text-xs text-slate-600 dark:text-slate-400 space-y-1">
                  <li>"I paid Rajesh 5000" (English)</li>
                  <li>"Rajesh ko five thousand diye" (Hindi-English Mix)</li>
                  <li>"Rajesh la 5000 rupaye dile" (Marathi)</li>
                  <li>"Mahesh kadun 7000 ghetle" (Marathi - Received)</li>
                  <li>"Suresh ko 12000 payment ki" (Hindi - Paid)</li>
                </ul>
              </div>

              <div className="border-t border-slate-100 dark:border-slate-800/80 pt-3">
                <h4 className="font-semibold text-brand-orange">Voice Command Phrases</h4>
                <p className="text-xs text-slate-500 mb-1.5">The assistant understands specific helper command phrases anytime:</p>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="bg-slate-100 dark:bg-slate-950 p-2 rounded border border-slate-200/50 dark:border-slate-800">
                    <b>"Start Listening"</b> / <b>"Mic on"</b>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-950 p-2 rounded border border-slate-200/50 dark:border-slate-800">
                    <b>"Stop"</b> / <b>"Stop Listening"</b>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-950 p-2 rounded border border-slate-200/50 dark:border-slate-800 col-span-2">
                    <b>"Yes"</b> / <b>"Save"</b> / <b>"Confirm"</b> (To confirm transactions)
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-950 p-2 rounded border border-slate-200/50 dark:border-slate-800 col-span-2">
                    <b>"No"</b> / <b>"Cancel"</b> / <b>"Clear"</b> (To discard transactions)
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-950 p-2 rounded border border-slate-200/50 dark:border-slate-800">
                    <b>"Delete last entry"</b>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-950 p-2 rounded border border-slate-200/50 dark:border-slate-800">
                    <b>"Open Google Sheet"</b>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-950 p-2 rounded border border-slate-200/50 dark:border-slate-800">
                    <b>"Show Today"</b>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-950 p-2 rounded border border-slate-200/50 dark:border-slate-800">
                    <b>"Repeat"</b>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 dark:border-slate-800/80 pt-3 text-xs text-slate-500">
                <p>Note: Today's reference local date is automatically detected based on your browser time.</p>
              </div>
            </div>

            <button
              onClick={() => setShowHelpModal(false)}
              className="mt-6 w-full py-2.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 font-semibold rounded-xl text-xs transition-all"
              id="got-it-help-btn"
            >
              Got It
            </button>
          </div>
        </div>
      )}

      {/* Delete Last Confirm Modal */}
      {showDeleteLastConfirm && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl relative">
            <h3 className="text-lg font-display font-bold mb-2 text-slate-900 dark:text-slate-100">
              Delete Last Entry?
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">
              Are you sure you want to delete the last entry in the spreadsheet? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  handleDeleteLastEntry();
                  setShowDeleteLastConfirm(false);
                }}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl text-xs transition-all shadow-sm"
              >
                Yes, Delete
              </button>
              <button
                onClick={() => setShowDeleteLastConfirm(false)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold rounded-xl text-xs transition-all border border-slate-200/50 dark:border-slate-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
