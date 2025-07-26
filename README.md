# 🕒 Timesheet Processor & Visualizer

A comprehensive solution for processing employee timesheet data with **Monday.com** and **Atlassian Jira** integration, featuring both local Python processing and web-based visualisation.

## 🌟 Two Ways to Use

### 1. **Local Processing** (Python Script)
- Download and configure the Python script locally
- Process raw timesheet files with full API integration
- Generate consolidated CSV reports
- Ideal for batch processing and automation

### 2. **Web Visualizer** (GitHub Pages)
- Access the web app directly in your browser
- Upload either raw timesheets OR pre-consolidated reports
- Interactive charts and visualisations
- No installation required

---

## 🚀 Getting Started

### Option A: Local Python Processing

1. **Download the Python script**: `timesheet_processor.py`
2. **Install requirements**:
   ```bash
   pip install pandas requests openpyxl
   ```
3. **Configure API credentials** in the script:
   ```python
   monday_api_key = "YOUR_MONDAY_API_KEY"
   atlassian_config = {
       "domain": "your-domain.atlassian.net",
       "email": "your-email@domain.com", 
       "api_token": "YOUR_ATLASSIAN_API_TOKEN"
   }
   ```
4. **Run processing**:
   ```bash
   python timesheet_processor.py your_timesheet.csv
   ```

### Option B: Web Visualizer

1. **Access the web app**: [🔗 [Timesheet Processor & Visualizer](https://md-sameer-ck.github.io/TimeSheetWizard/)]
2. **Upload your file**:
   - Raw timesheet (Excel) → Full processing with API calls
   - Consolidated report (CSV) → Direct visualisation
3. **Configure APIs** (optional): Click "Configure API Settings"
4. **Visualise**: Interactive charts, statistics, and data tables

---

## 📊 Features

### **Data Processing**
- ✅ Supports Excel (.xlsx) files
- 🔍 Extracts Monday.com IDs (10-digit) and Atlassian tickets (OPS-XXX)
- 📊 Fetches ticket details via API (names, story points)
- 🧠 Intelligent grouping and hour distribution
- 📁 Generates clean consolidated reports

### **Web Visualization** 
- 📈 Interactive charts (Bar, Pie, Doughnut)
- 👥 Employee hours distribution
- 📋 Task type breakdown  
- 🎫 Ticket source analysis
- 📥 Export options (CSV/JSON)

### **Smart File Detection**
- Raw timesheets → Full API processing
- Files with `Consolidated_Report` → Direct visualization
- Automatic workflow selection

---

## 📂 Input Formats

### Raw Timesheet Requirements:
- **Employee Name** (or Name, Worker, Employee)
- **Task** (or Task Type, Activity, Work Type) 
- **Total Hours** (or Hours, Time Spent, Duration)
- **Comments** (or Description, Notes)
- **Billing Type** (optional - filters for 'Billable' only)

### Consolidated Report Format:
Generated files contain: Task, Ticket ID, Ticket Name, Story Point, Logged Hours, Consolidated Comments, Employees Involved, Ticket Source

---

## 🔧 API Configuration

### Monday.com:
- Generate an API key from Monday.com developer settings
- GraphQL endpoint for item details and story points

### Atlassian Jira:
- Create an API token from Atlassian account settings  
- REST API for ticket summaries
- Requires domain, email, and token

---

## 📤 Output Examples

### Console Output:
```
=== Processing Complete ===
Original records: 68
Consolidated records: 23  
Original total hours: 143.75
Consolidated total hours: 143.75
Output: timesheet_Consolidated_Report.csv
```

### Web Statistics:
- Total Hours: 143.75
- Employees: 8
- Task Types: 12
- Tickets Processed: 15

---

## 🛠️ Use Cases

### **Local Python Script**:
- **Batch processing** multiple files
- **Automated workflows** and scheduling
- **Enterprise integration** with existing systems
- **Offline processing** of sensitive data

### **Web Visualizer**:
- **Quick analysis** and reporting
- **Stakeholder presentations** with interactive charts
- **Remote access** without software installation
- **Collaborative review** of processed data

---

## 🔒 Security Notes

- **Local script**: API credentials stored in a local file
- **Web app**: Credentials only in browser memory (not stored)
- **CORS limitations**: Some API calls may require a proxy for the web version
- **Data privacy**: Web processing happens client-side only

---

## 📈 Example Workflow

1. **Local Processing**: Use Python script to process raw timesheets → Generate `timesheet_Consolidated_Report.csv`
2. **Web Visualization**: Upload consolidated report to web app → Generate interactive charts for presentations
3. **Hybrid Approach**: Process locally for sensitive data, visualise online for sharing

---

## 🤝 Contributing

- Report issues with sample data (anonymised)
- Feature requests welcome
- API integration improvements
- Chart and visualisation enhancements

---

Built with ❤️ by Md Sameer for efficient timesheet management and visualisation.
