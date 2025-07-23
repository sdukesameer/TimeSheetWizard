#!/usr/bin/env python3
"""
Timesheet Processing Script
Processes employee timesheet data and generates reports with Monday.com integration
"""

import pandas as pd
import requests
import json
import re
import sys
from typing import Dict, List, Optional
import logging
from pathlib import Path
from datetime import datetime
import pytz

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class TimesheetProcessor:
    def __init__(self, board_id: str = "1693617285"):
        """
        Initialize the timesheet processor with hardcoded API key

        Args:
            board_id: Monday.com board ID (default: 1693617285)
        """
        self.monday_api_key = "eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjUzNjExODQ2MiwiYWFpIjoxMSwidWlkIjo1NDY2OTMyMiwiaWFkIjoiMjAyNS0wNy0wOFQwNzoyMzo1NC4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTc1NDgxNzksInJnbiI6ImV1YzEifQ.2-NxIoBsSOq6yvaRrXQfSaI0n89uCuxgbNjRmG3nQuo"  # Hardcoded API key
        self.board_id = board_id
        self.monday_url = "https://api.monday.com/v2"
        self.monday_headers = {
            "Authorization": self.monday_api_key,
            "Content-Type": "application/json"
        }
        self.monday_items_cache = {}
        self.included_task_types = {
            "Development & Unit Testing",
            "Production Support"
        }

    def read_timesheet_csv(self, file_path: str) -> pd.DataFrame:
        """
        Read and parse the CloudKaptan timesheet CSV file

        Args:
            file_path: Path to the timesheet CSV file

        Returns:
            DataFrame with parsed timesheet data
        """
        logger.info(f"Reading timesheet file: {file_path}")

        try:
            with open(file_path, 'r', encoding='utf-8') as file:
                lines = file.readlines()

            header_line_index = None
            for i, line in enumerate(lines):
                if "Employee Number" in line and "Employee Name" in line:
                    header_line_index = i
                    break

            if header_line_index is None:
                raise ValueError("Could not find header line in CSV")

            df = pd.read_csv(file_path, skiprows=header_line_index, encoding='utf-8')
            df = df.dropna(subset=['Employee Number', 'Employee Name', 'Task'])
            df = df[df['Employee Number'].str.contains('CKE-', na=False)]
            df['Total Hours'] = pd.to_numeric(df['Total Hours'], errors='coerce').fillna(0)
            df['Employee Name'] = df['Employee Name'].fillna('No Employee Name')
            df['Task'] = df['Task'].fillna('No Task')

            logger.info(f"Successfully loaded {len(df)} timesheet records")
            return df

        except Exception as e:
            logger.error(f"Error reading timesheet file: {e}")
            raise

    def extract_monday_ids(self, text: str) -> List[str]:
        """
        Extract Monday.com item IDs from text

        Args:
            text: Text to search for IDs

        Returns:
            List of found Monday.com IDs
        """
        if not text or pd.isna(text):
            return []
        ids = re.findall(r'\b\d{8,}\b', str(text))
        return list(set(ids))

    def fetch_monday_items(self, item_ids: List[str]) -> Dict[str, Dict[str, str]]:
        """
        Fetch specific items from Monday.com board using GraphQL query

        Args:
            item_ids: List of Monday.com item IDs to fetch

        Returns:
            Dictionary mapping item ID to item data (name and numbers column value)
        """
        if not item_ids:
            return {}

        logger.info(f"Fetching Monday.com items: {item_ids}")

        query = """
        query {
            items(ids: %s) {
                id
                name
                column_values(ids: ["numbers"]) {
                    value
                }
            }
        }
        """ % json.dumps(item_ids)

        try:
            response = requests.post(
                self.monday_url,
                json={'query': query},
                headers=self.monday_headers,
                timeout=30
            )
            response.raise_for_status()

            data = response.json()
            if 'errors' in data:
                logger.error(f"Monday.com API errors: {data['errors']}")
                return {}

            items = data.get('data', {}).get('items', [])
            result = {}
            for item in items:
                item_id = item['id']
                item_name = item['name']
                numbers_value = item.get('column_values', [{}])[0].get('value', '')
                numbers_value = numbers_value.strip('"') if numbers_value else ''
                result[item_id] = {'name': item_name, 'numbers': numbers_value}

            logger.info(f"Fetched {len(result)} Monday.com items")
            return result

        except requests.exceptions.RequestException as e:
            logger.error(f"Error fetching Monday.com items: {e}")
            return {}
        except Exception as e:
            logger.error(f"Unexpected error fetching Monday.com items: {e}")
            return {}

    def generate_summary_report(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Generate summary report grouped by Employee and Task (billable only)

        Args:
            df: Timesheet DataFrame

        Returns:
            Summary DataFrame
        """
        logger.info("Generating summary report")

        billable_df = df[df['Task Billing Type'] == 'Billable'].copy()
        grouped = billable_df.groupby(['Employee Name', 'Task']).agg({
            'Total Hours': 'sum',
            'Comments': lambda x: [str(comment) for comment in x if pd.notna(comment) and str(comment).strip()]
        }).reset_index()

        max_comments = grouped['Comments'].apply(len).max()
        for i in range(max_comments):
            grouped[f'Comment_{i+1}'] = grouped['Comments'].apply(lambda x: x[i] if i < len(x) else '')

        summary = grouped.drop(columns=['Comments'])
        summary = summary.sort_values(['Employee Name', 'Task'])

        logger.info(f"Generated summary with {len(summary)} entries")
        return summary

    def generate_template_format(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Generate report in the template format (similar to Template June.csv)

        Args:
            df: Timesheet DataFrame

        Returns:
            DataFrame in template format
        """
        logger.info("Generating template format report")

        billable_df = df[df['Task Billing Type'] == 'Billable'].copy()
        all_monday_ids = set()
        for _, row in billable_df.iterrows():
            if row['Task'] in self.included_task_types:
                all_monday_ids.update(self.extract_monday_ids(row['Comments']))

        monday_items = self.fetch_monday_items(list(all_monday_ids))
        template_rows = []

        for _, row in billable_df.iterrows():
            comments = str(row['Comments']) if pd.notna(row['Comments']) else ''
            task = row['Task']
            monday_ids = self.extract_monday_ids(comments) if task in self.included_task_types else []

            if monday_ids:
                for monday_id in monday_ids:
                    ticket_data = monday_items.get(monday_id, {'name': f"Ticket {monday_id}", 'numbers': ''})
                    template_rows.append({
                        'CATEGORY': task.upper(),
                        'MONDAY.COM ID': monday_id,
                        'TICKET DESCRIPTION': ticket_data['name'],
                        'ACTUAL HOURS SPENT': row['Total Hours']
                    })
            else:
                template_rows.append({
                    'CATEGORY': task.upper(),
                    'MONDAY.COM ID': '',
                    'TICKET DESCRIPTION': comments[:100] + '...' if len(comments) > 100 else comments,
                    'ACTUAL HOURS SPENT': row['Total Hours']
                })

        template_df = pd.DataFrame(template_rows)
        if not template_df.empty:
            template_df = template_df.groupby(['CATEGORY', 'MONDAY.COM ID', 'TICKET DESCRIPTION']).agg({
                'ACTUAL HOURS SPENT': 'sum'
            }).reset_index()

        logger.info(f"Generated template format with {len(template_df)} entries")
        return template_df

    def generate_detailed_report(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Generate detailed report with Employee Name, Task, Total Hours, Comments, and Monday.com data

        Args:
            df: Timesheet DataFrame

        Returns:
            Detailed DataFrame with Monday.com data
        """
        logger.info("Generating detailed report")

        billable_df = df[df['Task Billing Type'] == 'Billable'].copy()
        all_monday_ids = set()
        for _, row in billable_df.iterrows():
            if row['Task'] in self.included_task_types:
                all_monday_ids.update(self.extract_monday_ids(row['Comments']))

        monday_items = self.fetch_monday_items(list(all_monday_ids))
        detailed_rows = []

        for _, row in billable_df.iterrows():
            comments = str(row['Comments']) if pd.notna(row['Comments']) else ''
            task = row['Task']
            monday_ids = self.extract_monday_ids(comments) if task in self.included_task_types else []

            if monday_ids:
                for monday_id in monday_ids:
                    ticket_data = monday_items.get(monday_id, {'name': f"Ticket {monday_id}", 'numbers': ''})
                    detailed_rows.append({
                        'Task': task,
                        'Employee Name': row['Employee Name'],
                        'Comments': comments,
                        'Total Hours': row['Total Hours'],
                        'Ticket Name': ticket_data['name'],
                        'Story Point': ticket_data['numbers']
                    })
            else:
                detailed_rows.append({
                    'Task': task,
                    'Employee Name': row['Employee Name'],
                    'Comments': comments,
                    'Total Hours': row['Total Hours'],
                    'Ticket Name': '',
                    'Story Point': ''
                })

        detailed_df = pd.DataFrame(detailed_rows)
        detailed_df = detailed_df.sort_values(['Task', 'Employee Name', 'Comments'])
        logger.info(f"Generated detailed report with {len(detailed_df)} entries")
        return detailed_df

    def process_timesheet(self, input_file: str, output_dir: str = "output") -> Dict[str, str]:
        """
        Process timesheet file and generate all reports

        Args:
            input_file: Path to input timesheet CSV file
            output_dir: Directory to save output files (default: output)

        Returns:
            Dictionary with paths to generated files
        """
        logger.info(f"Starting timesheet processing for: {input_file}")

        Path(output_dir).mkdir(exist_ok=True)
        df = self.read_timesheet_csv(input_file)
        summary_df = self.generate_summary_report(df)
        template_df = self.generate_template_format(df)
        detailed_df = self.generate_detailed_report(df)

        base_name = Path(input_file).stem
        summary_file = f"{output_dir}/{base_name}_summary.csv"
        template_file = f"{output_dir}/{base_name}_template_format.csv"
        detailed_file = f"{output_dir}/{base_name}_detailed.csv"

        summary_df.to_csv(summary_file, index=False)
        template_df.to_csv(template_file, index=False)
        detailed_df.to_csv(detailed_file, index=False)

        logger.info("=== Processing Complete ===")
        logger.info(f"Total records processed: {len(df)}")
        logger.info(f"Billable records: {len(df[df['Task Billing Type'] == 'Billable'])}")
        logger.info(f"Summary entries: {len(summary_df)}")
        logger.info(f"Template entries: {len(template_df)}")
        logger.info(f"Detailed entries: {len(detailed_df)}")
        logger.info(f"Files generated:")
        logger.info(f"  - Summary: {summary_file}")
        logger.info(f"  - Template: {template_file}")
        logger.info(f"  - Detailed: {detailed_file}")

        return {
            'summary': summary_file,
            'template': template_file,
            'detailed': detailed_file
        }

def main():
    """Main function to run the script"""
    if len(sys.argv) < 2:
        print("Usage: python timesheet_processor.py <input_csv_file> [output_directory]")
        print("\nExample:")
        print("python timesheet_processor.py timesheet.csv [output_folder]")
        sys.exit(1)

    input_file = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else "output"

    if not Path(input_file).exists():
        print(f"Error: Input file '{input_file}' does not exist")
        sys.exit(1)

    try:
        processor = TimesheetProcessor()
        server_time = datetime.now(pytz.timezone('Asia/Kolkata')).strftime('%I:%M %p IST on %A, %B %d, %Y')
        results = processor.process_timesheet(input_file, output_dir)

        print("\n" + "="*50)
        print("PROCESSING COMPLETED SUCCESSFULLY!")
        print("="*50)
        print(f"Summary report: {results['summary']}")
        print(f"Template report: {results['template']}")
        print(f"Detailed report: {results['detailed']}")

    except Exception as e:
        print(f"Error processing timesheet: {e}")
        logger.error(f"Processing failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()