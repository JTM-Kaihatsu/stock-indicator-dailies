# **Stock Indicator Dailies MVP PRD**

# **Product Specification**

**Project Owner:** Takeshi  
**Date:** July 8, 2026  
**Status:** Draft/ Conceptual

## **Project Overview**

"Stock Indicator Dailies" is an AI-driven technical analysis utility designed to streamline the daily ritual of checking market signals. Driven from a personal need to gamify the boring repetitive task of logging in and inputting and reading off charts, the tool automates the tedious process of navigating financial charting platforms, configuring technical indicators, and performing visual pattern recognition. It provides a Buy, Sell, or Hold signal based on if the corresponding MACD, Slow Stochastic, and Simple 10-day MA lines have crossed.  
The MVP goal is to use an agent to authenticate successfully, navigate through charting settings, obtain the correct charts for a stock ticker, and then use a multimodal visual model to interpret the chart.

A planned Phase II extends this into financial-statement extraction and analysis/ synthesis. See “Future Features” for more details.

Note: This is not meant to provide financial advice, just to more easily obtain data.

## **Target Audience**

* **Retail Traders:** Who utilize specific technical setups but want to save time on manual chart adjustment.

## **Core Feature Requirements**

### **1\. Ticker Entry & Session Management**

The user interface will provide a clean, single-input field for the equity or ETF ticker symbol.

* Ticker Input: Support for standard exchange tickers (e.g., AAPL, NVDA, TSLA).  
* Credential Storage: Encrypted local storage or secure vault for charting platform login credentials (e.g., TradingView, StockCharts, or Brokerage APIs).

### **2\. Agentic Chart Acquisition**

The system will utilize an autonomous browser agent (e.g., Playwright or a dedicated AI Web Agent) to perform the following sequence:

* **Navigation:** Log in to the specified charting provider.  
* **Input Ticker:** Enter the user-provided symbol into the primary search bar.  
* **Parameter Configuration:**  
  * **MACD:** Set Fast Length to **8**, Slow Length to **17**, and Signal Smoothing to **9**.  
  * **Slow Stochastic:** Set %K to **14** and %D to **5**.  
  * **Simple Moving Average (SMA):** Set period to **10**.  
* **Visual Capture:** Execute a high-resolution screenshot of the rendered chart area, ensuring all three indicators are clearly visible within the frame.

### **3\. Visual Model LLM (VLM) Analysis**

The captured screenshot is passed to a Visual Language Model (e.g., Gemini 1.5 Pro or GPT-4o) with a specific system prompt to interpret the technical data.

| Indicator | Buy Signal Criteria | Sell Signal Criteria |
| :---- | :---- | :---- |
| **MACD (8, 17, 9\)** | Bullish crossover (MACD line crosses above Signal line) below the zero line. | Bearish crossover (MACD line crosses below Signal line) above the zero line. |
| **Slow Stoch (14, 5\)** | %K crosses above %D while in the oversold region (\<20). | %K crosses below %D while in the overbought region (\>80). |
| **10-day SMA** | Price closes above the 10-day SMA with upward slope. | Price closes below the 10-day SMA with downward slope. |

## **System Workflow**

1. **Trigger:** User enters "NVDA" into the Stock Dailies dashboard.  
2. **Execution:** The Agentic Layer wakes up, logs into the charting tool, applies the 8/17/9 MACD, 14/5 Stochastics, and 10-SMA, and snaps a PNG.  
3. **Inference:** The VLM analyzes the PNG against the criteria.  
4. **Reporting:** The UI displays a "Daily Report" card showing the screenshot and the final recommendation.

## **Technical Stack Recommendations**

* **Frontend:** Next.js for a responsive, modern web dashboard  
* **Agentic Layer:** Playwright for browser automation combined with a lightweight orchestration framework  
* **AI Layer:** A frontier multimodal model, e.g., Gemini/GPT-class VLM  
  * Track model drift for two parts:  
    * Retrieval: Simulate web page process and screenshot retrieval, use structural similarity index measure (SSIM) to determine match  
    * Chart interpretation: Given a chart image with ground truth data reporting buy/ sell/ hold, assert model results  
* **Database:** Supabase for user preferences and "Daily" history tracking

## **Security and Risk Considerations**

### **1\. Credential Management & Security**

The primary security concern involves the autonomous agent authenticating into external charting tools or brokerage environments on behalf of the user. To mitigate this risk, the following protocols will be implemented:

* **Encrypted Secret Storage:** Plaintext logging or storage of sensitive data is strictly prohibited. Credentials must be secured at rest via OS-level vaults (e.g., Keychain) or dedicated managers, ensuring isolation between keys and payloads.  
* **Token-Based Authentication:** Prioritize OAuth or scoped API keys (specifically read-only market data) over traditional passwords. This tool is designed to *observe* data without the capability to execute transactions.  
* **Permission Scoping:** The agent operates under the principle of least privilege, with access restricted solely to chart rendering. Trade execution is explicitly excluded from the MVP roadmap.  
* **Local-First Architecture:** To minimize exposure, user credentials remain on the local device and are not transmitted to centralized servers.

### **2\. Automation Failure Modes**

Executing browser-based automation against dynamic financial platforms introduces several technical hurdles:

* **DOM Volatility:** Layout shifts can disrupt agent navigation. We will implement structural validation of the screenshot to ensure all three indicators are captured before proceeding to inference.  
* **Compliance Review:** Automation must align with provider ToS. Official API integration is the preferred path over scraping to maintain service integrity.  
* **Bot Mitigation:** To prevent account suspension, the system utilizes human-like interaction timing and adheres to strict rate-limiting thresholds.

### **3\. VLM Reliability & Verification**

Since the VLM generates the core signal, identifying and preventing inaccuracies is critical:

* **Hallucination Safeguards:** VLMs may misidentify technical patterns. We mitigate this through an SSIM-based eval framework and by displaying the source screenshot so users can verify signals manually.  
* **Human-in-the-Loop:** The system serves as a reporting tool only. Final investment decisions remain the sole responsibility of the user.

### **4\. Data Stewardship & Privacy**

* **Local Data Sovereignty:** All session logs, preferences, and cached assets are managed via Supabase (or similar local-first persistent storage). Users retain full ownership with the ability to trigger a complete history purge.  
* **Image Sanitization:** To prevent exposure of account-identifying metadata, the system executes regional cropping on all screenshots. Captured visual data is restricted to the "Dailies" internal history and is never broadcast to external entities.

## **Success Metrics**

* **Time-to-Signal:** Acquisition and analysis completed in under 15 seconds.  
* **Accuracy:** Retrieval and interpretation should be measured and tested independently to assess performance and prevent model drift  
  * Chart Retrieval compared to a series of web pages in a test set and SSIM should be used to determine that the chart has been correctly obtained (target ≥ 95% similarity)  
  * Buy/sell/hold interpretation matches labeled ground-truth labels on a test set with 100% accuracy  
* **Engagement:** User completes their "Dailies" for at least 5 consecutive trading days.

## **Future Features**

* Designate preferred technical indicator and parameter  
* Notification system for daily reporting sent via email  
* Saved sessions to preserve portfolio reporting \+ changes over time  
* Phase II: Financials  
  * OCR: Use AWS Textract for table and text blocks  
  * LLM: Pull and extract key numbers from financials  
    * Map: Obtain relevant embeddings based on k-nn heuristic  
    * Reduce: Apply extraction logic based on contextual information, datatyping, and non-LLM mathematical cross-checks for business logic  
  * Algorithmic: Calculate ratios and percent change between 10-year, 5-year, 3-year, and 1-year (present to FE)  
  * LLM interpretation of ratios; potentially pull any latest news and public opinion on the company and synthesize

