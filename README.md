---

````markdown
# 🕒 Timesheet Processor

A robust and automated Python-based tool to process employee timesheet data from `.csv` or `.xlsx` files. It integrates with **Monday.com** and **Atlassian Jira** APIs to fetch ticket details, group tasks, and generate a **consolidated report** with enhanced traceability.

---

## 🚀 Features

- ✅ Accepts both `.csv` and `.xlsx` timesheet files
- 🔍 Extracts ticket IDs (Monday.com item IDs & Atlassian OPS tickets) from comments
- 📊 Fetches ticket details (like name & story points) via API
- 🧠 Automatically groups and consolidates similar tasks/tickets
- 📁 Outputs a clean, readable `.csv` report
- ⚙️ Caching to avoid redundant API calls
- 🛑 Skips known non-ticket tasks like meetings and deployments

---

## 📦 Requirements

- Python 3.7+
- Required libraries:
  - `pandas`
  - `requests`
  - `openpyxl`

Install them via:

```bash
pip install pandas requests openpyxl
````

---

## 📂 Input Format

Your timesheet file must include the following columns (or their aliases):

* **Employee Name** (aliases: Name, Worker, Employee)
* **Task** (aliases: Task Type, Activity, Work Type)
* **Total Hours** (aliases: Hours, Time Spent, Duration)
* **Comments** (aliases: Description, Notes)

Additionally, a **Billing Type** column (`Billable` entries only) is supported if present.

---

## 🛠️ Setup

Before running the script, configure your API credentials:

In the `main()` function or via environment variables:

### Monday.com

```python
monday_api_key = "YOUR_MONDAY_API_KEY"
```

### Atlassian Jira

```python
atlassian_config = {
    "domain": "your-domain.atlassian.net",
    "email": "your-email@example.com",
    "api_token": "YOUR_ATLASSIAN_API_TOKEN"
}
```

---

## ⚙️ Usage

### Basic Command

```bash
python timesheet_consolidator.py <input_file> [output_directory]
```

### Examples

```bash
python timesheet_consolidator.py timesheet.csv
python timesheet_consolidator.py timesheet.xlsx ./output/
```

---

## 📤 Output

The script generates a CSV file named:

```
<input_file_name>_Consolidated_Report.csv
```

This file includes:

| Task | Ticket ID | Ticket Name | Story Point | Logged Hours | Consolidated Comments | Employees Involved | Ticket Source |
| ---- | --------- | ----------- | ----------- | ------------ | --------------------- | ------------------ | ------------- |

---

## 🧠 Logic Summary

* Extracts `Monday.com` IDs (10-digit numbers) and `OPS-XXX` tickets from comments.
* Groups hours by Task + Ticket, splitting hours evenly if multiple tickets are mentioned.
* Skips Monday/Atlassian API calls for tasks like:

  * Dev Ops Activity
  * Deployment
  * Meetings & Discussions
* Merges duplicate comments and lists involved employees.

---

## ✅ Example Output

```
Consolidated report saved to: ./timesheet_Consolidated_Report.csv
Processed at: 11:23 AM on Tuesday, July 23, 2025
Original records: 68
Consolidated records: 23
Original total hours: 143.75
Consolidated total hours: 143.75
```

---

## 🔒 Security Note

**Do not hardcode your API tokens in public repositories.** Use environment variables or a `.env` file in production environments.

---

## 🧩 Future Enhancements

* GUI-based uploader
* Slack/Email integration for auto-delivery
* Validation for non-billable hours
* Monthly auto-scheduler with cron

---

## 🤝 Contributions

Open to improvements or integrations! Create a PR or file an issue.

---

## 📜 License

MIT License – use it freely but responsibly.

---

> Built with ❤️ by Md Sameer