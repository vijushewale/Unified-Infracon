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
  ExternalLink
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

export default function App() {
  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Sheets Config State
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(() => localStorage.getItem("sheet_id"));
  const [sheetUrl, setSheetUrl] = useState<string | null>(() => localStorage.getItem("sheet_url"));
  const [isEnsuringSheet, setIsEnsuringSheet] = useState(false);
  const [entries, setEntries] = useState<TransactionEntry[]>([]);
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);

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

  // UI state
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [filterType, setFilterType] = useState<"All" | "Paid" | "Received">("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [successNotification, setSuccessNotification] = useState<string | null>(null);
  const [errorNotification, setErrorNotification] = useState<string | null>(null);

  // Manual input when amount is missing
  const [manualAmount, setManualAmount] = useState<string>("");

  // Initialize Auth state
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, accessToken) => {
        setUser(currentUser);
        setToken(accessToken);
        setNeedsAuth(false);
      },
      () => {
        setUser(null);
        setToken(null);
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, []);

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

  // Handle Sheet Connection once authenticated
  useEffect(() => {
    if (token && !needsAuth) {
      ensureGoogleSheet();
    }
  }, [token, needsAuth]);

  // Fetch entries when sheet is connected
  useEffect(() => {
    if (token && spreadsheetId) {
      fetchSheetEntries();
    }
  }, [token, spreadsheetId]);

  // Keep assistant instructions updated with latest state
  useEffect(() => {
    if (needsAuth) {
      setAssistantText("Please sign in with Google to enable Unified Infracon and automatically link with Google Sheets.");
    } else if (isEnsuringSheet) {
      setAssistantText("Setting up your Google Sheets ledger. Please wait...");
    } else if (parsedTransaction) {
      if (parsedTransaction.amountMissing) {
        setAssistantText(`I understood: "${parsedTransaction.name || "Self"}" transaction but the amount is missing. Please enter or speak the amount.`);
      } else {
        setAssistantText(`I understood: ${parsedTransaction.type} ${parsedTransaction.amount} to/from ${parsedTransaction.name || "Self"} on ${parsedTransaction.date}. Should I save? Speak 'Yes' or click Save.`);
      }
    } else {
      setAssistantText("Click the microphone and speak naturally! E.g. 'Paid Rajesh five thousand rupees' or 'Rajesh ko panchtas rupaye diye' or 'Mahesh kadun sat hajar ghetle'.");
    }
  }, [needsAuth, isEnsuringSheet, parsedTransaction]);

  // Trigger TTS voice response
  const speak = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    
    // Stop any ongoing speech
    window.speechSynthesis.cancel();

    // Check language patterns in text to select voice
    let lang = "en-US";
    if (text.includes("यशस्वीरित्या") || text.includes("झाले") || text.includes("रुपये") || text.includes("माहिती")) {
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

  // Login handler
  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setToken(result.accessToken);
        setUser(result.user);
        setNeedsAuth(false);
        showSuccess("Logged in successfully!");
      }
    } catch (err: any) {
      console.error(err);
      showError("Sign in failed. Popups might be blocked by your browser. Click 'Open App in New Tab' to sign in securely!");
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Logout handler
  const handleLogout = async () => {
    try {
      await logout();
      setUser(null);
      setToken(null);
      setSpreadsheetId(null);
      setSheetUrl(null);
      setEntries([]);
      setNeedsAuth(true);
      showSuccess("Logged out successfully.");
    } catch (err: any) {
      showError("Logout failed.");
    }
  };

  // Search or Create "Voice Ledger AI" spreadsheet in Google Sheets
  const ensureGoogleSheet = async () => {
    if (!token) return;
    setIsEnsuringSheet(true);
    try {
      const res = await fetch("/api/sheets/ensure-sheet", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        throw new Error("Failed to configure Google Sheet ledger.");
      }

      const data = await res.json();
      setSpreadsheetId(data.spreadsheetId);
      setSheetUrl(data.url);
      if (data.newlyCreated) {
        showSuccess("New Google Sheet ledger 'Unified Infracon' created!");
        speak("Google Sheet configured successfully.");
      }
    } catch (err: any) {
      console.error(err);
      showError("Could not link with Google Sheets. Please re-authenticate.");
    } finally {
      setIsEnsuringSheet(false);
    }
  };

  // Fetch entries from Google Sheets
  const fetchSheetEntries = async () => {
    if (!token || !spreadsheetId) return;
    setIsLoadingEntries(true);
    try {
      const res = await fetch(`/api/sheets/list?spreadsheetId=${spreadsheetId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } catch (err) {
      console.error("Fetch entries error:", err);
    } finally {
      setIsLoadingEntries(false);
    }
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
      rec.lang = "en-US"; // Standard multilingual fallback; Web Speech detects mixed language well on standard configs

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

  // Handle parsing once we have clean text (either from speech recognition or simulation input)
  const handleVoiceInputParsed = async (textToParse: string) => {
    if (!textToParse || textToParse.trim().length === 0) return;

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
        setWaitingForConfirmation(true);
        triggerConfirmationSpeech(data);
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
    const confirmed = window.confirm("Are you sure you want to delete the last entry in the spreadsheet?");
    if (confirmed) {
      handleDeleteLastEntry();
    }
  };

  // Submit parsed transaction to Google Sheets
  const handleSaveTransaction = async () => {
    if (!token || !spreadsheetId || !parsedTransaction) return;
    
    // Check if amount is still missing
    if (parsedTransaction.amountMissing && !manualAmount) {
      showError("Please enter the transaction amount first!");
      speak("Rakkum sanga, please state or enter the amount.");
      return;
    }

    const transactionToSave = {
      ...parsedTransaction,
      amount: parsedTransaction.amountMissing ? parseFloat(manualAmount) : parsedTransaction.amount,
    };

    setIsSaving(true);
    try {
      const res = await fetch("/api/sheets/append", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          spreadsheetId,
          transaction: transactionToSave,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to write to Google Sheets");
      }

      showSuccess(`Transaction saved to spreadsheet successfully!`);
      
      // Voice feedback
      let feedback = "";
      if (parsedTransaction.detectedLanguage === "Marathi") {
        feedback = `${transactionToSave.name || "व्यवहार"} साठी ${transactionToSave.amount} रुपये यशस्वीरित्या सेव्ह झाले. माहिती गुगल शीट मध्ये जोडली गेली आहे.`;
      } else if (parsedTransaction.detectedLanguage === "Hindi") {
        feedback = `${transactionToSave.name || "लेनदेन"} के ${transactionToSave.amount} रुपये सफलतापूर्वक सहेज लिए गए हैं।`;
      } else {
        feedback = `Transaction of ${transactionToSave.amount} saved successfully.`;
      }
      speak(feedback);

      // Reset transaction states
      setParsedTransaction(null);
      setWaitingForConfirmation(false);
      setManualAmount("");
      setSimulatedText("");
      setLastTranscript("");
      
      // Refresh list
      fetchSheetEntries();
    } catch (err: any) {
      console.error(err);
      showError("Failed to save. Google Sheets permissions might have expired.");
    } finally {
      setIsSaving(false);
    }
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

  // Delete last spreadsheet row
  const handleDeleteLastEntry = async () => {
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
          </div>
        </header>

        {/* OAuth Authentication Screen (If not signed in) */}
        {needsAuth ? (
          <div className="max-w-xl mx-auto my-12 py-10 px-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-3xl shadow-xl text-center glow-blue transition-all duration-300">
            <div className="p-4 bg-brand-orange/10 text-brand-orange rounded-2xl w-fit mx-auto mb-6">
              <Database className="h-10 w-10 animate-pulse" />
            </div>
            <h2 className="text-2xl md:text-3xl font-display font-bold mb-3">
              Connect Google Sheets Ledger
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 max-w-sm mx-auto leading-relaxed">
              Sign in with your Google account. We will automatically create a secure <b>Unified Infracon</b> spreadsheet inside your Google Drive to log and calculate your spoken entries.
            </p>

            {/* Embedded Iframe Popup Blocker Notice */}
            <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 rounded-xl text-left flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  Are popups blocked?
                </h4>
                <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-1 leading-relaxed">
                  Inside the AI Studio preview iframe, browsers block Google sign-in popups. 
                  For a fully seamless sign-in, click the <b>Open App in New Tab</b> button below, sign in there, and then your session will automatically sync here!
                </p>
              </div>
            </div>

            {/* Actions: Sign In or Open In New Tab */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 max-w-md mx-auto">
              <button 
                onClick={handleLogin}
                disabled={isLoggingIn}
                id="google-signin-btn"
                className="w-full sm:w-1/2 py-3 px-4 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 font-medium rounded-xl flex items-center justify-center gap-2.5 shadow-sm hover:shadow transition-all disabled:opacity-50 text-sm"
              >
                {isLoggingIn ? (
                  <RefreshCw className="h-4 w-4 animate-spin text-slate-500" />
                ) : (
                  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="h-4 w-4 shrink-0">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  </svg>
                )}
                <span>{isLoggingIn ? "Connecting..." : "Sign in with Google"}</span>
              </button>

              <button 
                onClick={() => window.open(window.location.href, "_blank")}
                className="w-full sm:w-1/2 py-3 px-4 bg-brand-orange text-white hover:bg-brand-orange/90 font-medium rounded-xl flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all text-sm"
              >
                <ExternalLink className="h-4 w-4" />
                <span>Open App in New Tab</span>
              </button>
            </div>
            
            <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 text-left">
              <h3 className="text-xs font-semibold font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">
                Supported Vijay Speech
              </h3>
              <div className="grid grid-cols-3 gap-2 text-center text-xs text-slate-500 dark:text-slate-400">
                <div className="bg-slate-100 dark:bg-slate-800/50 p-2.5 rounded-lg border border-slate-200/50 dark:border-slate-800/50 font-medium">
                  Marathi (मराठी)
                </div>
                <div className="bg-slate-100 dark:bg-slate-800/50 p-2.5 rounded-lg border border-slate-200/50 dark:border-slate-800/50 font-medium">
                  Hindi (हिंदी)
                </div>
                <div className="bg-slate-100 dark:bg-slate-800/50 p-2.5 rounded-lg border border-slate-200/50 dark:border-slate-800/50 font-medium">
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

                {/* Real-time speech result feed */}
                {(transcript || lastTranscript) && (
                  <div className="p-3.5 bg-brand-orange/5 border border-brand-orange/20 rounded-xl mb-4">
                    <span className="text-[10px] font-bold font-mono text-brand-orange uppercase tracking-wider">
                      Spoken Transcript:
                    </span>
                    <p className="text-sm font-sans font-semibold text-slate-800 dark:text-slate-200 italic mt-0.5">
                      "{transcript || lastTranscript}"
                    </p>
                  </div>
                )}

                {/* Parsing / AI Processing Loader */}
                {isParsing && (
                  <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex flex-col items-center justify-center z-10">
                    <RefreshCw className="h-8 w-8 text-brand-orange animate-spin mb-2" />
                    <span className="text-xs font-semibold text-white">Gemini Extracting Ledger Data...</span>
                  </div>
                )}
              </div>

              {/* Simulation Entry Box for standard text backup */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/90 rounded-3xl p-5 shadow-lg">
                <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  Type Natural Command (Simulation)
                </h3>
                <div className="flex gap-2">
                  <input 
                    type="text"
                    value={simulatedText}
                    onChange={(e) => setSimulatedText(e.target.value)}
                    placeholder="E.g. Rajesh ko 5000 diye, or click Help"
                    className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-brand-orange"
                    onKeyDown={(e) => e.key === "Enter" && triggerSimulationParse()}
                    id="simulation-input"
                  />
                  <button 
                    onClick={triggerSimulationParse}
                    className="px-4 py-2 bg-brand-orange hover:bg-brand-orange-hover text-white rounded-xl text-xs font-semibold transition-all shadow-sm"
                    id="simulate-btn"
                  >
                    Analyze
                  </button>
                </div>
                {recognitionError && (
                  <p className="text-xs text-amber-500 font-medium mt-3 flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {recognitionError}
                  </p>
                )}
              </div>

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
                
                {/* Search & Filter Header */}
                <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 mb-6">
                  <div>
                    <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <FileText className="h-5 w-5 text-brand-orange" />
                      Recent Entries
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Total {filteredEntries.length} items found
                    </p>
                  </div>

                  <div className="flex items-center gap-2.5">
                    {/* CSV Download Button */}
                    {entries.length > 0 && (
                      <button
                        onClick={handleDownloadCSV}
                        className="p-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl text-slate-600 dark:text-slate-300 transition-all"
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
                        className="p-2.5 bg-slate-100 hover:bg-rose-500/10 dark:bg-slate-800 dark:hover:bg-rose-500/10 rounded-xl text-slate-600 dark:text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 transition-all"
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
                      className="p-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl text-slate-600 dark:text-slate-300 transition-all"
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

                {/* Grid Lists */}
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
                      Add entries via spoken natural voice commands!
                    </p>
                  </div>
                ) : (
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
    </div>
  );
}
