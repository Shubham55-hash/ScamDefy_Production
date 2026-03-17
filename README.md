# ScamDefy — Advanced AI Threat Detection System

ScamDefy is a multi-layered security platform designed to detect and block modern scams across web, voice, and message channels using state-of-the-art AI models and security databases.

## 🚀 Key Features

### 1. Unified Surveillance Dashboard
A centralized command center providing real-time stats and a historical log of all detected threats across all modules.

### 2. Deep Web Scanner
- **URL Analysis**: Real-time risk assessment of URLs for phishing, malware, and social engineering.
- **Score Breakdown**: Granular visibility into risk factors (GSB, URLHaus, Domain Age, Brand Integrity, Heuristics).
- **Expansion**: Automatic expansion of shortened URLs to uncover hidden destinations.

### 3. Neural Voice Inspector (AI Voice Detection)
- **Deepfake Detection**: Analyzes audio to distinguish between real human voices and AI-generated synthetic speech.
- **Live Monitor**: Continuous real-time voice monitoring via microphone with rolling 6-second analysis chunks.
- **Visual Waveform**: Real-time visualization of audio frequency data.

### 4. Message Shield
- **Pattern Matching**: Heuristic detection of common messaging scam tactics (urgency, prize lures, credential requests).
- **Reasoning**: Specific explanations for why a message was flagged.

### 5. Smart Browser Extension
- **Automated Protection**: Intercepts navigations to block dangerous sites before they load.
- **Warning System**: Full-page warning redirects and in-page caution banners.
- **Whitelist**: Allows user-approved exceptions for specific targets.

---

## 📊 Scoring Methodology

ScamDefy uses a proprietary multi-weighted algorithm to determine the **Risk Score (0-100)** for every scanned URL.

### 1. Authoritative Overrides
If a URL is detected by **Google Safe Browsing** or **URLHaus**, the system grants an immediate **100/100 (BLOCKED)** status, as these are confirmed global threats.

### 2. Weighted Heuristic Calculation
For URLs not yet blacklisted, the system calculates a score based on the following weights:
| Component | Weight | Description |
| :--- | :--- | :--- |
| **Authority Check** | 40% | Checks against GSB and URLHaus databases. |
| **Domain Analysis** | 15% | Typosquatting, character substitutions (Levenshtein distance). |
| **URL Patterns** | 15% | Suspicious keywords, length, IP-based hosting, and non-HTTPS. |
| **Domain Age** | 15% | Penalty for "Newborn" domains (< 7 days) and young domains (< 6 months). |
| **Impersonation** | 15% | Pattern matching against 50+ high-value brand names in the hostname. |

### 3. Verdict Thresholds
- **BLOCKED (80-100)**: Immediate threat, automatic redirection to warning page.
- **DANGER (60-79)**: High-risk indicators, block recommended.
- **CAUTION (30-59)**: Suspicious signals, in-page caution banner displayed.
- **SAFE (0-29)**: No major threat indicators found.

---

## 🔧 Tech Stack & Tools

ScamDefy leverages modern engineering tools and frameworks:

### 🚀 Backend (Python)
- **FastAPI**: High-performance async web framework for the main API logic.
- **Hugging Face (Transformers)**: Powers the **Neural Voice Inspector** using pre-trained audio models.
- **Librosa / SoundFile**: Audio processing and feature extraction.
- **Pydantic**: Data validation and settings management.
- **Uvicorn**: Lightning-fast ASGI server.

### ⚛️ Frontend (React)
- **React + TypeScript**: Robust component-based UI development.
- **Vite**: Modern build tool for an instant development experience.
- **Tailwind CSS**: Utility-first styling for the Cyberpunk aesthetic.
- **Zustand / Lucide React**: State management and iconography.

### 🧩 Browser Extension
- **Chrome Extension (Manifest V3)**: Modern extension architecture for intercepting network requests and injecting security UI.

### ⛓️ Databases & Services
- **Google Safe Browsing API**: Real-time malware/phishing repository.
- **URLHaus API**: Malware URL feed from Abuse.ch.
- **Google Gemini 1.5 Pro**: AI-driven risk explanation and context generation.

---

## 📦 Project Structure
- `/frontend`: React + TypeScript + Tailwind Cyberpunk UI.
- `/backend`: FastAPI + Python service layer.
- `/extension`: Manifest V3 browser extension for proactive protection.
