#!/usr/bin/env python3
"""
Timesheet Consolidation Script
Processes employee timesheet data and generates consolidated reports with Monday.com and Atlassian integration
"""

import pandas as pd
import requests
import json
import re
import sys
from typing import Dict, List, Optional, Set
import logging
from pathlib import Path
from datetime import datetime
from collections import defaultdict

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class TimesheetConsolidator:
    def __init__(self, monday_api_key: str = None, atlassian_config: Dict = None):
        """
        Initialize the consolidator with API configurations

        Args:
            monday_api_key: Monday.com API key
            atlassian_config: Dictionary containing atlassian_domain, atlassian_email, atlassian_api_token
        """
        # Monday.com API configuration
        self.monday_api_key = monday_api_key or "YOUR_MONDAY_API_KEY_HERE"
        self.monday_url = "https://api.monday.com/v2"
        self.monday_headers = {
            "Authorization": self.monday_api_key,
            "Content-Type": "application/json"
        }

        # Atlassian API configuration
        self.atlassian_config = atlassian_config or {}
        self.atlassian_domain = self.atlassian_config.get("domain", "your-domain.atlassian.net")
        self.atlassian_email = self.atlassian_config.get("email", "your-email@domain.com")
        self.atlassian_api_token = self.atlassian_config.get("api_token", "YOUR_ATLASSIAN_API_TOKEN_HERE")

        self.atlassian_headers = {
            "Accept": "application/json",
            "Content-Type": "application/json"
        }

        # Cache for API responses
        self.monday_cache = {}
        self.atlassian_cache = {}

        # Tasks that should not fetch API details
        self.no_api_tasks = {
            "Dev Ops Activity",
            "Deployment",
            "Meetings & Discussions"
        }

    def read_timesheet_file(self, file_path: str) -> pd.DataFrame:
        """
        Read and parse the timesheet file (CSV or XLSX)

        Args:
            file_path: Path to the timesheet file

        Returns:
            DataFrame with parsed timesheet data
        """
        logger.info(f"Reading timesheet file: {file_path}")

        try:
            file_extension = Path(file_path).suffix.lower()

            if file_extension == '.xlsx':
                # Skip the first two rows and use row 3 as headers
                df = pd.read_excel(file_path, engine='openpyxl', skiprows=2)
            elif file_extension == '.csv':
                df = pd.read_csv(file_path, encoding='utf-8')
            else:
                raise ValueError(f"Unsupported file format: {file_extension}. Use .csv or .xlsx")

            # Log the column names for debugging
            logger.info(f"Columns found in file: {list(df.columns)}")

            # Validate required columns
            required_columns = ['Employee Name', 'Task', 'Total Hours', 'Comments']
            missing_columns = [col for col in required_columns if col not in df.columns]

            if missing_columns:
                # Try alternative column names
                column_mapping = {
                    'Employee Name': ['Employee Name', 'Name', 'Worker', 'Employee'],
                    'Task': ['Task', 'Task Type', 'Activity', 'Work Type'],
                    'Total Hours': ['Total Hours', 'Hours', 'Time Spent', 'Duration'],
                    'Comments': ['Comments', 'Comment', 'Description', 'Notes']
                }

                for missing_col in missing_columns:
                    found = False
                    for alt_name in column_mapping.get(missing_col, []):
                        if alt_name in df.columns:
                            df = df.rename(columns={alt_name: missing_col})
                            logger.info(f"Renamed column '{alt_name}' to '{missing_col}'")
                            found = True
                            break
                    if not found:
                        raise ValueError(f"Required column '{missing_col}' not found in file")

            # Filter for billable tasks only
            if 'Task Billing Type' in df.columns:
                df = df[df['Task Billing Type'] == 'Billable'].copy()
            elif 'Billing Type' in df.columns:
                df = df[df['Billing Type'] == 'Billable'].copy()
            else:
                logger.warning("No billing type column found. Processing all records.")

            # Clean data
            df = df.dropna(subset=['Employee Name', 'Task', 'Total Hours'])
            df['Total Hours'] = pd.to_numeric(df['Total Hours'], errors='coerce').fillna(0)
            df['Comments'] = df['Comments'].fillna('')

            logger.info(f"Successfully loaded {len(df)} billable timesheet records")
            return df

        except Exception as e:
            logger.error(f"Error reading timesheet file: {e}")
            raise

    def extract_monday_ids(self, text: str) -> List[str]:
        """
        Extract Monday.com item IDs from text
        Monday IDs are exactly 10-digit numbers
        """
        if not text or pd.isna(text):
            return []

        # Find all 10-digit numeric IDs
        ids = re.findall(r'\b\d{10}\b', str(text))

        # No normalization needed since we're only accepting 10-digit IDs
        return list(set(ids))

    def extract_ops_tickets(self, text: str) -> List[str]:
        """
        Extract OPS- ticket IDs from text for Atlassian integration
        Handles formats like OPS-XXX, OPS - XXX, OPS - XXXX
        """
        if not text or pd.isna(text):
            return []

        # Look for OPS tickets with flexible spacing
        ops_tickets = re.findall(r'OPS\s*-\s*\d+', str(text), re.IGNORECASE)

        # Normalize to OPS-XXX format
        normalized_tickets = []
        for ticket in ops_tickets:
            normalized = re.sub(r'\s*-\s*', '-', ticket.upper())
            normalized_tickets.append(normalized)

        return list(set(normalized_tickets))

    def fetch_monday_items(self, item_ids: List[str]) -> Dict[str, Dict[str, str]]:
        """
        Fetch items from Monday.com using GraphQL API

        Args:
            item_ids: List of Monday.com item IDs

        Returns:
            Dictionary mapping item ID to item details (name, story_point)
        """
        if not item_ids or self.monday_api_key == "YOUR_MONDAY_API_KEY_HERE":
            logger.warning("Monday.com API not configured. Skipping Monday.com integration.")
            return {}

        logger.info(f"Fetching Monday.com items: {item_ids}")

        # Check cache first
        uncached_ids = [id for id in item_ids if id not in self.monday_cache]
        result = {id: self.monday_cache[id] for id in item_ids if id in self.monday_cache}

        if not uncached_ids:
            return result

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
        """ % json.dumps(uncached_ids)

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
                return result

            items = data.get('data', {}).get('items', [])
            for item in items:
                item_id = item['id']
                item_name = item['name']

                # Remove emojis (keep extended ASCII, 0-255)
                item_name = ''.join(char for char in item_name if ord(char) < 256)

                # Extract story point from numbers column
                story_point = ''
                column_values = item.get('column_values', [])
                if column_values and column_values[0].get('value'):
                    story_point = column_values[0]['value'].strip('"')
                    # Remove emojis from story point
                    story_point = ''.join(char for char in story_point if ord(char) < 256)

                item_data = {
                    'name': item_name,
                    'story_point': story_point
                }

                result[item_id] = item_data
                self.monday_cache[item_id] = item_data

            logger.info(f"Fetched {len(items)} Monday.com items")
            return result

        except requests.exceptions.RequestException as e:
            logger.error(f"Error fetching Monday.com items: {e}")
            return result
        except Exception as e:
            logger.error(f"Unexpected error fetching Monday.com items: {e}")
            return result

    def fetch_atlassian_tickets(self, ticket_ids: List[str]) -> Dict[str, str]:
        """
        Fetch ticket information from Atlassian Jira

        Args:
            ticket_ids: List of OPS- ticket IDs

        Returns:
            Dictionary mapping ticket ID to ticket summary
        """
        if not ticket_ids or self.atlassian_api_token == "YOUR_ATLASSIAN_API_TOKEN_HERE":
            logger.warning("Atlassian API not configured. Skipping Atlassian integration.")
            return {}

        logger.info(f"Fetching Atlassian tickets: {ticket_ids}")

        # Check cache first
        uncached_tickets = [ticket for ticket in ticket_ids if ticket not in self.atlassian_cache]
        result = {ticket: self.atlassian_cache[ticket] for ticket in ticket_ids if ticket in self.atlassian_cache}

        for ticket_id in uncached_tickets:
            try:
                url = f"https://{self.atlassian_domain}/rest/api/3/issue/{ticket_id}"

                response = requests.get(
                    url,
                    headers=self.atlassian_headers,
                    auth=(self.atlassian_email, self.atlassian_api_token),
                    timeout=30
                )

                if response.status_code == 200:
                    issue_data = response.json()
                    summary = issue_data.get('fields', {}).get('summary', f'Ticket {ticket_id}')
                    # Remove emojis (keep extended ASCII, 0-255)
                    summary = ''.join(char for char in summary if ord(char) < 256)
                    result[ticket_id] = summary
                    self.atlassian_cache[ticket_id] = summary
                    logger.info(f"Fetched {ticket_id}: {summary}")
                elif response.status_code == 404:
                    logger.warning(f"Ticket {ticket_id} not found")
                    result[ticket_id] = f"Ticket {ticket_id} (Not Found)"
                    self.atlassian_cache[ticket_id] = result[ticket_id]
                else:
                    logger.warning(f"Error fetching {ticket_id}: HTTP {response.status_code}")
                    result[ticket_id] = f"Ticket {ticket_id}"
                    self.atlassian_cache[ticket_id] = result[ticket_id]

            except requests.exceptions.RequestException as e:
                logger.error(f"Error fetching {ticket_id}: {e}")
                result[ticket_id] = f"Ticket {ticket_id}"
                self.atlassian_cache[ticket_id] = result[ticket_id]

        return result

    def consolidate_timesheet(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Consolidate timesheet data by grouping similar tickets and tasks

        Args:
            df: Input timesheet DataFrame

        Returns:
            Consolidated DataFrame
        """
        logger.info("Starting timesheet consolidation")

        # Collect all unique ticket IDs for batch processing
        all_monday_ids = set()
        all_ops_tickets = set()

        for _, row in df.iterrows():
            task = row['Task']
            comments = str(row['Comments'])

            # Skip API calls for certain task types
            if task not in self.no_api_tasks:
                all_monday_ids.update(self.extract_monday_ids(comments))
                all_ops_tickets.update(self.extract_ops_tickets(comments))

        # Fetch all ticket details in batch
        logger.info("Fetching ticket details from external APIs...")
        monday_items = self.fetch_monday_items(list(all_monday_ids))
        atlassian_tickets = self.fetch_atlassian_tickets(list(all_ops_tickets))

        # Group data for consolidation
        consolidation_groups = defaultdict(lambda: {
            'total_hours': 0,
            'comments': [],
            'employees': set(),
            'ticket_name': '',
            'story_point': '',
            'ticket_source': 'Manual Entry'
        })

        for _, row in df.iterrows():
            task = row['Task']
            employee = row['Employee Name']
            hours = float(row['Total Hours'])
            comments = str(row['Comments'])

            # Extract ticket IDs
            monday_ids = self.extract_monday_ids(comments) if task not in self.no_api_tasks else []
            ops_tickets = self.extract_ops_tickets(comments) if task not in self.no_api_tasks else []

            tickets_found = monday_ids + ops_tickets

            if not tickets_found:
                # No tickets found - group by task and first 100 chars of comments
                key = f"{task}||{comments[:100]}"
                group = consolidation_groups[key]
                group['total_hours'] += hours
                group['comments'].append(comments)
                group['employees'].add(employee)
                group['ticket_name'] = comments[:100] + ('...' if len(comments) > 100 else '')
                group['ticket_source'] = 'Manual Entry'
            else:
                # Distribute hours equally among found tickets
                hours_per_ticket = hours / len(tickets_found)

                # Process Monday.com tickets
                for monday_id in monday_ids:
                    ticket_data = monday_items.get(monday_id, {})
                    ticket_name = ticket_data.get('name', f'Monday Item {monday_id}')
                    story_point = ticket_data.get('story_point', '')

                    key = f"{task}|{monday_id}|{ticket_name}"
                    group = consolidation_groups[key]
                    group['total_hours'] += hours_per_ticket
                    group['comments'].append(comments)
                    group['employees'].add(employee)
                    group['ticket_name'] = ticket_name
                    group['story_point'] = story_point
                    group['ticket_source'] = 'Monday.com'

                # Process Atlassian tickets
                for ops_ticket in ops_tickets:
                    ticket_name = atlassian_tickets.get(ops_ticket, f'Ticket {ops_ticket}')

                    key = f"{task}|{ops_ticket}|{ticket_name}"
                    group = consolidation_groups[key]
                    group['total_hours'] += hours_per_ticket
                    group['comments'].append(comments)
                    group['employees'].add(employee)
                    group['ticket_name'] = ticket_name
                    group['story_point'] = ''  # Atlassian tickets don't have story points
                    group['ticket_source'] = 'Atlassian'

        # Create consolidated report
        consolidated_rows = []
        for key, group_data in consolidation_groups.items():
            parts = key.split('|', 2)
            task = parts[0]
            ticket_id = parts[1] if len(parts) > 1 and parts[1] else ''

            # Consolidate comments with newlines
            unique_comments = []
            seen_comments = set()
            for comment in group_data['comments']:
                comment = comment.strip()
                if comment and comment not in seen_comments:
                    unique_comments.append(comment)
                    seen_comments.add(comment)

            # Join comments with \n for newlines in the same cell
            consolidated_comments = '\n'.join(unique_comments)
            employees_involved = ', '.join(sorted(group_data['employees']))

            consolidated_rows.append({
                'Task': task,
                'Ticket ID': ticket_id,
                'Ticket Name': group_data['ticket_name'],
                'Story Point': group_data['story_point'],
                'Logged Hours': round(group_data['total_hours'], 2),
                'Consolidated Comments': consolidated_comments,
                'Employees Involved': employees_involved,
                'Ticket Source': group_data['ticket_source']
            })

        consolidated_df = pd.DataFrame(consolidated_rows)
        consolidated_df = consolidated_df.sort_values(['Task', 'Ticket ID'])

        logger.info(f"Consolidated {len(df)} records into {len(consolidated_df)} groups")
        return consolidated_df

    def process_timesheet(self, input_file: str, output_dir: str = None) -> str:
        """
        Main processing function

        Args:
            input_file: Path to input timesheet file
            output_dir: Output directory (optional)

        Returns:
            Path to generated consolidated report
        """
        logger.info(f"Processing timesheet: {input_file}")

        # Read and validate input file
        df = self.read_timesheet_file(input_file)

        # Generate consolidated report
        consolidated_df = self.consolidate_timesheet(df)

        # Prepare output file path
        input_path = Path(input_file)
        if output_dir:
            output_path = Path(output_dir)
            output_path.mkdir(exist_ok=True)
        else:
            output_path = input_path.parent

        output_file = output_path / f"{input_path.stem}_Consolidated_Report.csv"

        # Validate output file name
        if not output_file.name.endswith('_Consolidated_Report.csv'):
            logger.error(f"Output file name must end with '_Consolidated_Report.csv', got: {output_file.name}")
            raise ValueError(f"Output file name must end with '_Consolidated_Report.csv', got: {output_file.name}")

        # Save consolidated report
        consolidated_df.to_csv(output_file, index=False)

        # Print summary
        total_original_hours = df['Total Hours'].sum()
        total_consolidated_hours = consolidated_df['Logged Hours'].sum()

        logger.info("=== Processing Complete ===")
        logger.info(f"Original records: {len(df)}")
        logger.info(f"Consolidated records: {len(consolidated_df)}")
        logger.info(f"Original total hours: {total_original_hours:.2f}")
        logger.info(f"Consolidated total hours: {total_consolidated_hours:.2f}")
        logger.info(f"Output file: {output_file}")

        return str(output_file)


def main():
    """Main function to run the script"""
    if len(sys.argv) < 2:
        print("Usage: python timesheet_consolidator.py <input_file> [output_directory]")
        print("\nExample:")
        print("python timesheet_consolidator.py timesheet.csv")
        print("python timesheet_consolidator.py timesheet.xlsx output/")
        print("\nIMPORTANT: Configure API credentials in the script before running!")
        sys.exit(1)

    input_file = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else None

    if not Path(input_file).exists():
        print(f"Error: Input file '{input_file}' does not exist")
        sys.exit(1)

    # Configure API credentials here
    monday_api_key = "YOUR_MONDAY_API_KEY_HERE"  # Replace with your Monday.com API key

    atlassian_config = {
        "domain": "your-domain.atlassian.net",  # Replace with your Atlassian domain
        "email": "your-email@domain.com",  # Replace with your email
        "api_token": "YOUR_ATLASSIAN_API_TOKEN_HERE"  # Replace with your Atlassian API token
    }

    try:
        # Initialize consolidator with API configurations
        consolidator = TimesheetConsolidator(
            monday_api_key=monday_api_key,
            atlassian_config=atlassian_config
        )

        # Process timesheet
        output_file = consolidator.process_timesheet(input_file, output_dir)

        print("\n" + "="*60)
        print("TIMESHEET CONSOLIDATION COMPLETED SUCCESSFULLY!")
        print("="*60)
        print(f"Consolidated report saved to: {output_file}")
        print(f"Processed at: {datetime.now().strftime('%I:%M %p on %A, %B %d, %Y')}")

    except Exception as e:
        print(f"Error processing timesheet: {e}")
        logger.error(f"Processing failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()