// Global Variables
let rawData = null;
let processedData = null;
let charts = {};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    document.getElementById('successMessage').classList.add('hidden');
}

function showSuccess(message) {
    const successDiv = document.getElementById('successMessage');
    successDiv.textContent = message;
    successDiv.classList.remove('hidden');
    document.getElementById('errorMessage').classList.add('hidden');
}

function hideMessages() {
    document.getElementById('errorMessage').classList.add('hidden');
    document.getElementById('successMessage').classList.add('hidden');
}

function updateProgress(percentage, status, detail = '') {
    document.getElementById('progressFill').style.width = percentage + '%';
    const statusText = detail ? `${status} - ${detail}` : status;
    document.getElementById('processingStatus').textContent = statusText;
}

function showProcessing() {
    document.getElementById('processingPanel').style.display = 'block';
    updateProgress(0, 'Initializing...');
    hideMessages();
}

function hideProcessing() {
    document.getElementById('processingPanel').style.display = 'none';
}

function showControlsAfterProcessing() {
    document.getElementById('resourceFilter').classList.remove('hidden');
    document.getElementById('chartType').classList.remove('hidden');
    populateResourceFilter();
}

function populateResourceFilter() {
    const resourceFilter = document.getElementById('resourceFilter');
    const uniqueEmployees = new Set();

    processedData.forEach(row => {
        if (row['Employees Involved']) {
            const employees = row['Employees Involved'].split(',');
            employees.forEach(emp => {
                const employee = emp.trim();
                if (employee) uniqueEmployees.add(employee);
            });
        }
    });

    // Clear existing options except "All Employees"
    resourceFilter.innerHTML = '<option value="all">👥 All Employees</option>';

    // Add employee options
    Array.from(uniqueEmployees).sort().forEach(employee => {
        const option = document.createElement('option');
        option.value = employee;
        option.textContent = `👤 ${employee}`;
        resourceFilter.appendChild(option);
    });
}

function filterDataAndRefresh() {
    const selectedResource = document.getElementById('resourceFilter').value;

    let filteredData = processedData;

    if (selectedResource !== 'all') {
        filteredData = [];

        processedData.forEach(row => {
            const employeeHours = row['Employee Hours'] || {};
            const individualHours = employeeHours[selectedResource];

            if (individualHours && individualHours > 0) {
                // Create a new row with only the selected employee's data
                const newEmployeeHours = {};
                newEmployeeHours[selectedResource] = individualHours;

                filteredData.push({
                    ...row,
                    'Logged Hours': Math.round(individualHours * 100) / 100,
                    'Employees Involved': selectedResource,
                    'Employee Hours': newEmployeeHours
                });
            }
        });
    }

    // Temporarily replace processedData for visualization
    const originalData = processedData;
    processedData = filteredData;

    updateStatistics();
    createCharts();
    createDataTable();

    // Restore original data
    processedData = originalData;
}

// ==========================================
// FILE HANDLING
// ==========================================

function getFileBaseName() {
    const fileInput = document.getElementById('fileInput');
    const fileName = fileInput.files[0]?.name || 'timesheet';
    return fileName.split('.')[0];
}

async function readFile(file) {
    return new Promise((resolve, reject) => {
        const fileExtension = '.' + file.name.split('.').pop().toLowerCase();

        if (fileExtension === '.csv') {
            Papa.parse(file, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true,
                complete: function(results) {
                    if (results.errors.length > 0) {
                        reject(new Error('CSV parsing error: ' + results.errors[0].message));
                    } else {
                        resolve(results.data);
                    }
                },
                error: function(error) {
                    reject(error);
                }
            });
        } else if (fileExtension === '.xlsx') {
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, {type: 'array'});
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];

                    // Skip first 2 rows and use row 3 as headers
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
                        range: 2, // Start from row 3 (0-indexed)
                        defval: ''
                    });

                    resolve(jsonData);
                } catch (error) {
                    reject(new Error('Excel file parsing error: ' + error.message));
                }
            };
            reader.onerror = function() {
                reject(new Error('Failed to read Excel file'));
            };
            reader.readAsArrayBuffer(file);
        } else {
            reject(new Error('Unsupported file format'));
        }
    });
}

// ==========================================
// DATA PROCESSING
// ==========================================

function normalizeColumns(data) {
    if (!data || data.length === 0) {
        throw new Error('No data found in file');
    }

    const columnMapping = {
        'Employee Name': ['Employee Name', 'Name', 'Worker', 'Employee'],
        'Task': ['Task', 'Task Type', 'Activity', 'Work Type'],
        'Total Hours': ['Total Hours', 'Hours', 'Time Spent', 'Duration'],
        'Comments': ['Comments', 'Comment', 'Description', 'Notes'],
        'Task Billing Type': ['Task Billing Type', 'Billing Type', 'Billing']
    };

    const normalizedData = data.map(row => {
        const normalizedRow = {};

        // Normalize column names
        for (const [standardName, alternatives] of Object.entries(columnMapping)) {
            let found = false;
            for (const alt of alternatives) {
                if (row.hasOwnProperty(alt)) {
                    normalizedRow[standardName] = row[alt];
                    found = true;
                    break;
                }
            }
            if (!found && standardName !== 'Task Billing Type') {
                // Check if any similar column exists (case-insensitive)
                const similarKey = Object.keys(row).find(key => {
                    const keyLower = key.toLowerCase();
                    return alternatives.some(alt => keyLower.includes(alt.toLowerCase()) || alt.toLowerCase().includes(keyLower));
                });
                if (similarKey) {
                    normalizedRow[standardName] = row[similarKey];
                }
            }
        }

        // Copy any additional columns
        for (const [key, value] of Object.entries(row)) {
            if (!Object.values(columnMapping).flat().includes(key)) {
                normalizedRow[key] = value;
            }
        }

        return normalizedRow;
    });

    // Filter for billable entries only
    const filteredData = normalizedData.filter(row => {
        const billingType = row['Task Billing Type'];
        return !billingType || billingType === 'Billable';
    });

    // Debug: Log available columns
    if (filteredData.length > 0) {
        console.log('Available columns:', Object.keys(filteredData[0]));
    }

    // Validate required columns
    const requiredColumns = ['Employee Name', 'Task', 'Total Hours', 'Comments'];
    const sampleRow = filteredData[0] || {};
    const missingColumns = requiredColumns.filter(col => !sampleRow.hasOwnProperty(col));

    if (missingColumns.length > 0) {
        console.error('Missing columns:', missingColumns);
        console.error('Available columns:', Object.keys(sampleRow));
        throw new Error(`Missing required columns: ${missingColumns.join(', ')}. Available columns: ${Object.keys(sampleRow).join(', ')}`);
    }

    // Clean and validate data
    const cleanedData = filteredData.filter(row => {
        return row['Employee Name'] && row['Task'] &&
               (row['Total Hours'] !== null && row['Total Hours'] !== undefined && row['Total Hours'] !== '');
    }).map(row => ({
        ...row,
        'Total Hours': parseFloat(row['Total Hours']) || 0,
        'Comments': row['Comments'] || ''
    }));

    if (cleanedData.length === 0) {
        throw new Error('No valid billable timesheet records found');
    }

    return cleanedData;
}

function extractAllTickets(data) {
    const mondayIds = new Set();
    const opsTickets = new Set();
    const noApiTasks = new Set(['Dev Ops Activity', 'Deployment', 'Meetings & Discussions']);

    data.forEach(row => {
        const task = row['Task'];
        const comments = String(row['Comments'] || '');

        if (!noApiTasks.has(task)) {
            // Extract Monday.com IDs (10-digit numbers)
            const mondayMatches = comments.match(/\b\d{10}\b/g);
            if (mondayMatches) {
                mondayMatches.forEach(id => mondayIds.add(id));
            }

            // Extract OPS tickets
            const opsMatches = comments.match(/OPS\D*(\d+)/gi);
            if (opsMatches) {
                opsMatches.forEach(match => {
                    const number = match.match(/\d+/)[0];
                    const normalized = `OPS-${number}`;
                    opsTickets.add(normalized);
                });
            }
        }
    });

    return {
        mondayIds: Array.from(mondayIds),
        opsTickets: Array.from(opsTickets)
    };
}

function processConsolidatedReport(data) {
    // Expected columns in consolidated reports
    const expectedColumns = ['Task', 'Ticket ID', 'Ticket Name', 'Story Point', 'Logged Hours', 'Consolidated Comments', 'Employees Involved', 'Ticket Source'];

    // Validate consolidated report format
    const firstRow = data[0] || {};
    const hasConsolidatedColumns = expectedColumns.some(col => firstRow.hasOwnProperty(col));

    if (!hasConsolidatedColumns) {
        throw new Error('File does not appear to be a valid consolidated report');
    }

    // Clean and validate data
    return data.filter(row => {
        return row['Task'] && (row['Logged Hours'] !== null && row['Logged Hours'] !== undefined && row['Logged Hours'] !== '');
    }).map(row => ({
        'Task': row['Task'] || '',
        'Ticket ID': row['Ticket ID'] || '',
        'Ticket Name': row['Ticket Name'] || '',
        'Story Point': row['Story Point'] || '',
        'Logged Hours': parseFloat(row['Logged Hours']) || 0,
        'Consolidated Comments': row['Consolidated Comments'] || '',
        'Employees Involved': row['Employees Involved'] || '',
        'Ticket Source': row['Ticket Source'] || 'Manual Entry'
    })).sort((a, b) => {
        if (a.Task !== b.Task) {
            return a.Task.localeCompare(b.Task);
        }
        const aName = String(a['Ticket Name'] || '');
        const bName = String(b['Ticket Name'] || '');
        return aName.localeCompare(bName);
    });
}

function consolidateData(rawData, apiData) {
    const { mondayData, atlassianData } = apiData;
    const consolidationGroups = {};
    const noApiTasks = new Set(['Dev Ops Activity', 'Deployment', 'Meetings & Discussions']);

    rawData.forEach(row => {
        const task = row['Task'];
        const employee = row['Employee Name'];
        const hours = parseFloat(row['Total Hours']) || 0;
        const comments = String(row['Comments'] || '');

        // Extract ticket IDs
        const mondayIds = noApiTasks.has(task) ? [] : (comments.match(/\b\d{10}\b/g) || []);
        const opsTickets = noApiTasks.has(task) ? [] :
            (comments.match(/OPS\s*-\s*\d+/gi) || []).map(ticket =>
                ticket.replace(/\s*-\s*/, '-').toUpperCase()
            );

        const allTickets = [...mondayIds, ...opsTickets];

        if (allTickets.length === 0 || (Object.keys(mondayData).length === 0 && Object.keys(atlassianData).length === 0)) {

            // No tickets found - group by task and first 100 chars of comments
            const key = `${task}||${comments.substring(0, 100)}`;

            if (!consolidationGroups[key]) {
                consolidationGroups[key] = {
                    task: task,
                    ticketId: '',
                    ticketName: comments.substring(0, 100) + (comments.length > 100 ? '...' : ''),
                    storyPoint: '',
                    totalHours: 0,
                    comments: new Set(),
                    employees: new Set(),
                    ticketSource: 'Manual Entry'
                };
            }

            const group = consolidationGroups[key];
            group.totalHours += hours;
            group.comments.add(comments);
            group.employees.add(employee);
            if (!group.employeeHours) {
                group.employeeHours = {};
            }
            group.employeeHours[employee] = (group.employeeHours[employee] || 0) + hours;
        } else {
            // Distribute hours equally among found tickets
            const hoursPerTicket = hours / allTickets.length;

            // Process Monday.com tickets
            mondayIds.forEach(mondayId => {
                const ticketData = mondayData[mondayId] || {};
                const ticketName = ticketData.name || `Monday Item ${mondayId}`;
                const storyPoint = ticketData.story_point || '';

                const key = `${task}|${mondayId}|${ticketName}`;

                if (!consolidationGroups[key]) {
                    consolidationGroups[key] = {
                        task: task,
                        ticketId: Object.keys(mondayData).length > 0 ? mondayId : '',
                        ticketName: ticketName,
                        storyPoint: storyPoint,
                        totalHours: 0,
                        comments: new Set(),
                        employees: new Set(),
                        ticketSource: Object.keys(mondayData).length > 0 ? 'Monday.com' : 'Manual Entry'
                    };
                }

                const group = consolidationGroups[key];
                group.totalHours += hours;
                group.comments.add(comments);
                group.employees.add(employee);
                if (!group.employeeHours) {
                    group.employeeHours = {};
                }
                group.employeeHours[employee] = (group.employeeHours[employee] || 0) + hours;
            });

            // Process Atlassian tickets
            opsTickets.forEach(opsTicket => {
                const ticketName = atlassianData[opsTicket] || `Ticket ${opsTicket}`;
                const key = `${task}|${opsTicket}|${ticketName}`;

                if (!consolidationGroups[key]) {
                    consolidationGroups[key] = {
                        task: task,
                        ticketId: Object.keys(atlassianData).length > 0 ? opsTicket : '',
                        ticketName: ticketName,
                        storyPoint: '',
                        totalHours: 0,
                        comments: new Set(),
                        employees: new Set(),
                        ticketSource: Object.keys(atlassianData).length > 0 ? 'Atlassian' : 'Manual Entry'
                    };
                }

                const group = consolidationGroups[key];
                group.totalHours += hours;
                group.comments.add(comments);
                group.employees.add(employee);
                if (!group.employeeHours) {
                    group.employeeHours = {};
                }
                group.employeeHours[employee] = (group.employeeHours[employee] || 0) + hours;
            });
        }
    });

    // Convert to final format
    const consolidatedData = Object.values(consolidationGroups).map(group => {
        // Get unique comments and join with newlines
        const uniqueComments = Array.from(group.comments)
            .filter(comment => comment.trim())
            .filter((comment, index, array) => array.indexOf(comment) === index);

        return {
            'Task': group.task,
            'Ticket ID': group.ticketId,
            'Ticket Name': group.ticketName,
            'Story Point': group.storyPoint,
            'Logged Hours': Math.round(group.totalHours * 100) / 100,
            'Consolidated Comments': uniqueComments.join('\n'),
            'Employees Involved': Array.from(group.employees).sort().join(', '),
            'Ticket Source': group.ticketSource,
            'Employee Hours': group.employeeHours || {}
        };
    });

    // Sort by task and ticket name
    consolidatedData.sort((a, b) => {
        const taskA = String(a.Task || a['Task'] || '').trim();
        const taskB = String(b.Task || b['Task'] || '').trim();

        if (taskA !== taskB) {
            return taskA.localeCompare(taskB);
        }

        const nameA = String(a['Ticket Name'] || '').trim();
        const nameB = String(b['Ticket Name'] || '').trim();
        return nameA.localeCompare(nameB);
    });

    return consolidatedData;
}

// ==========================================
// API INTEGRATION
// ==========================================

async function fetchAPIDataWithProgress(ticketInfo) {
    const mondayData = {};
    const atlassianData = {};

    let currentProgress = 35;

    // Fetch Monday.com data
    if (ticketInfo.mondayIds.length > 0) {
        try {
            updateProgress(currentProgress, 'Fetching Monday.com data', `Processing ${ticketInfo.mondayIds.length} items`);

            const mondayResult = await fetchMondayItemsWithProgress(ticketInfo.mondayIds);
            Object.assign(mondayData, mondayResult);
            currentProgress = 60;
        } catch (error) {
            console.warn('Monday.com API error:', error);
        }
    }

    // Fetch Atlassian data
    if (ticketInfo.opsTickets.length > 0) {
        try {
            const atlassianResult = await fetchAtlassianTicketsWithProgress(
                ticketInfo.opsTickets,
                currentProgress
            );
            Object.assign(atlassianData, atlassianResult);
        } catch (error) {
            console.warn('Atlassian API error:', error);
        }
    }

    return { mondayData, atlassianData };
}

async function fetchMondayItemsWithProgress(itemIds) {
    // Progress simulation showing individual ticket IDs
    for (let i = 0; i < itemIds.length; i++) {
        const progress = 35 + (i / itemIds.length) * 25;
        updateProgress(progress, 'Fetching Monday.com data', `${itemIds[i]} (${i + 1}/${itemIds.length})`);
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Call Lambda function
    const lambdaUrl = '/.netlify/functions/monday';
    const response = await fetch(`${lambdaUrl}?itemIds=${encodeURIComponent(JSON.stringify(itemIds))}`, {
        method: 'GET',
        headers: {
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`Monday.com Lambda error: ${response.status}`);
    }

    const data = await response.json();

    if (data.errors) {
        throw new Error(`Monday.com API errors: ${JSON.stringify(data.errors)}`);
    }

    const result = {};
    const items = data.data?.items || [];

    items.forEach(item => {
        const itemId = item.id;
        const itemName = item.name.replace(/[^\x00-\xFF]/g, '');

        let storyPoint = '';
        const columnValues = item.column_values || [];
        if (columnValues.length > 0 && columnValues[0].value) {
            storyPoint = columnValues[0].value.replace(/"/g, '').replace(/[^\x00-\xFF]/g, '');
        }

        result[itemId] = {
            name: itemName,
            story_point: storyPoint
        };
    });

    return result;
}

async function fetchAtlassianTicketsWithProgress(ticketIds, startProgress) {
    const result = {};
    const progressStep = 25 / ticketIds.length;
    const lambdaUrl = '/.netlify/functions/atlassian';

    for (let i = 0; i < ticketIds.length; i++) {
        const ticketId = ticketIds[i];
        const currentProgress = startProgress + (i * progressStep);

        updateProgress(
            Math.round(currentProgress),
            'Fetching Atlassian data',
            `${ticketId} (${i + 1}/${ticketIds.length})`
        );

        try {
            const response = await fetch(`${lambdaUrl}?ticketId=${ticketId}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                const summary = data.fields?.summary || `Ticket ${ticketId}`;
                result[ticketId] = summary.replace(/[^\x00-\xFF]/g, '');
            } else {
                result[ticketId] = `Ticket ${ticketId}`;
            }

            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
            console.warn(`Error fetching ${ticketId}:`, error);
            result[ticketId] = `Ticket ${ticketId}`;
        }
    }

    return result;
}

// ==========================================
// MAIN PROCESSING FUNCTION
// ==========================================

async function processTimesheet() {
    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];

    if (!file) {
        showError('Please select a timesheet file first!');
        return;
    }

    const validExtensions = ['.csv', '.xlsx'];
    const fileExtension = '.' + file.name.split('.').pop().toLowerCase();

    if (!validExtensions.includes(fileExtension)) {
        showError('Please select a valid CSV or Excel file.');
        return;
    }

    const isConsolidatedReport = file.name.includes('Consolidated_Report');
    showProcessing();

    try {
        // Step 1: Read the file
        updateProgress(5, 'Upload successful', '');
        await new Promise(resolve => setTimeout(resolve, 300));

        updateProgress(10, 'File validated', '');
        rawData = await readFile(file);

        if (isConsolidatedReport) {
            updateProgress(35, 'API triggering', 'Processing consolidated report');
            await new Promise(resolve => setTimeout(resolve, 300));

            updateProgress(50, 'Processing consolidated report', '');
            processedData = processConsolidatedReport(rawData);

            updateProgress(95, 'Consolidating data', '');
            await new Promise(resolve => setTimeout(resolve, 300));

            updateProgress(100, 'Complete', '');
            generateVisualization();

            setTimeout(() => {
                hideProcessing();
                showSuccess(`Loaded consolidated report with ${processedData.length} entries!`);
                showControlsAfterProcessing();
                document.getElementById('downloadSection').classList.add('hidden');
                document.getElementById('statsPanel').classList.remove('hidden');
                document.getElementById('chartsContainer').classList.remove('hidden');
                document.getElementById('dataTable').classList.remove('hidden');
            }, 500);
        } else {
            updateProgress(20, 'Normalizing data', '');
            rawData = normalizeColumns(rawData);
            await new Promise(resolve => setTimeout(resolve, 300));

            updateProgress(30, 'Extracting ticket information', '');
            const ticketInfo = extractAllTickets(rawData);
            await new Promise(resolve => setTimeout(resolve, 300));

            updateProgress(35, 'API triggering', '');
            const apiData = await fetchAPIDataWithProgress(ticketInfo);

            updateProgress(85, 'Consolidating data', '');
            processedData = consolidateData(rawData, apiData);
            await new Promise(resolve => setTimeout(resolve, 300));

            updateProgress(95, 'Generating visualizations', '');
            generateVisualization();
            await new Promise(resolve => setTimeout(resolve, 300));

            updateProgress(100, 'Complete', '');

            setTimeout(() => {
                hideProcessing();
                showSuccess(`Successfully processed ${rawData.length} records into ${processedData.length} consolidated entries!`);
                showControlsAfterProcessing();
                document.getElementById('downloadSection').classList.remove('hidden');
                document.getElementById('statsPanel').classList.remove('hidden');
                document.getElementById('chartsContainer').classList.remove('hidden');
                document.getElementById('dataTable').classList.remove('hidden');
            }, 500);
        }

    } catch (error) {
        hideProcessing();
        showError('Error processing timesheet: ' + error.message);
        console.error('Processing error:', error);
    }
}

// ==========================================
// VISUALIZATION FUNCTIONS
// ==========================================

function generateVisualization() {
    updateStatistics();
    createCharts();
    createDataTable();
}

function updateStatistics() {
    const totalHours = processedData.reduce((sum, row) => sum + (row['Logged Hours'] || 0), 0);

    const uniqueEmployees = new Set();
    const uniqueTasks = new Set();
    let ticketCount = 0;

    processedData.forEach(row => {
        if (row['Employees Involved']) {
            const employees = row['Employees Involved'].split(',');
            employees.forEach(emp => {
                const employee = emp.trim();
                if (employee) uniqueEmployees.add(employee);
            });
        }
        if (row['Task']) {
            uniqueTasks.add(row['Task']);
        }
        if (row['Ticket ID'] || row['Task']) {
            ticketCount++;
        }
    });

    document.getElementById('totalHours').textContent = totalHours.toFixed(2);
    document.getElementById('totalEmployees').textContent = uniqueEmployees.size;
    document.getElementById('totalTasks').textContent = uniqueTasks.size;
    document.getElementById('totalTickets').textContent = ticketCount;
}

function getChartColors(count) {
    const colors = [
        '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
        '#FF9F40', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
        '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE'
    ];
    return Array.from({length: count}, (_, i) => colors[i % colors.length]);
}

function createCharts() {
    // Destroy existing charts
    Object.values(charts).forEach(chart => {
        if (chart) chart.destroy();
    });
    charts = {};

    const chartType = document.getElementById('chartType').value;

    createEmployeeChart(chartType);
    createTaskChart(chartType);
    createSourceChart(chartType);
    createTicketChart('bar');
}

function createEmployeeChart(chartType) {
    const employeeHours = {};

    // Add fallback logic
    processedData.forEach(row => {
        const employeeHoursData = row['Employee Hours'] || {};

        // If no Employee Hours data, parse from 'Employees Involved'
        if (Object.keys(employeeHoursData).length === 0 && row['Employees Involved']) {
            const employees = row['Employees Involved'].split(',');
            const hoursPerEmployee = (row['Logged Hours'] || 0) / employees.length;
            employees.forEach(emp => {
                const employee = emp.trim();
                if (employee) {
                    employeeHours[employee] = (employeeHours[employee] || 0) + hoursPerEmployee;
                }
            });
        } else {
            // Use existing Employee Hours data
            Object.entries(employeeHoursData).forEach(([employee, hours]) => {
                if (employee && hours > 0) {
                    employeeHours[employee] = (employeeHours[employee] || 0) + hours;
                }
            });
        }
    });

    const sortedEmployees = Object.entries(employeeHours)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10);

    if (sortedEmployees.length === 0) return;

    const ctx = document.getElementById('employeeChart').getContext('2d');

    let chartConfig = {
        type: chartType,
        data: {
            labels: sortedEmployees.map(([name]) => name),
            datasets: [{
                label: 'Hours',
                data: sortedEmployees.map(([,hours]) => hours),
                backgroundColor: getChartColors(sortedEmployees.length),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: chartType !== 'bar'
                }
            }
        }
    };

    if (chartType === 'bar') {
        chartConfig.options.scales = {
            y: {
                beginAtZero: true,
                title: {
                    display: true,
                    text: 'Hours'
                }
            }
        };
    } else if (chartType === 'line') {
        chartConfig.data.datasets[0] = {
            label: 'Hours',
            data: sortedEmployees.map(([,hours]) => hours),
            borderColor: '#667eea',
            backgroundColor: 'rgba(102, 126, 234, 0.1)',
            fill: true,
            tension: 0.4
        };
        chartConfig.options.scales = {
            y: { beginAtZero: true }
        };
    }

    charts.employee = new Chart(ctx, chartConfig);
}

function createTaskChart(chartType) {
    const taskHours = {};

    processedData.forEach(row => {
        const task = row['Task'] || 'Unknown';
        const hours = row['Logged Hours'] || 0;
        taskHours[task] = (taskHours[task] || 0) + hours;
    });

    const sortedTasks = Object.entries(taskHours)
        .sort(([,a], [,b]) => b - a);

    if (sortedTasks.length === 0) return;

    const ctx = document.getElementById('taskChart').getContext('2d');

    let chartConfig = {
        type: chartType,
        data: {
            labels: sortedTasks.map(([name]) => name),
            datasets: [{
                label: 'Hours',
                data: sortedTasks.map(([,hours]) => hours),
                backgroundColor: getChartColors(sortedTasks.length),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: chartType !== 'bar'
                }
            }
        }
    };

    if (chartType === 'bar') {
        chartConfig.options.scales = {
            y: {
                beginAtZero: true,
                title: {
                    display: true,
                    text: 'Hours'
                }
            }
        };
    } else if (chartType === 'line') {
        chartConfig.data.datasets[0] = {
            label: 'Hours',
            data: sortedTasks.map(([,hours]) => hours),
            borderColor: '#764ba2',
            backgroundColor: 'rgba(118, 75, 162, 0.1)',
            fill: true,
            tension: 0.4
        };
        chartConfig.options.scales = {
            y: { beginAtZero: true }
        };
    }

    charts.task = new Chart(ctx, chartConfig);
}

function createSourceChart(chartType) {
    const sourceHours = {};

    processedData.forEach(row => {
        const source = row['Ticket Source'] || 'Unknown';
        const hours = row['Logged Hours'] || 0;
        sourceHours[source] = (sourceHours[source] || 0) + hours;
    });

    const sortedSources = Object.entries(sourceHours)
        .sort(([,a], [,b]) => b - a);

    if (sortedSources.length === 0) return;

    const ctx = document.getElementById('sourceChart').getContext('2d');

    let chartConfig = {
        type: chartType,
        data: {
            labels: sortedSources.map(([name]) => name),
            datasets: [{
                label: 'Hours',
                data: sortedSources.map(([,hours]) => hours),
                backgroundColor: getChartColors(sortedSources.length),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: chartType !== 'bar'
                }
            }
        }
    };

    if (chartType === 'bar') {
        chartConfig.options.scales = {
            y: {
                beginAtZero: true,
                title: {
                    display: true,
                    text: 'Hours'
                }
            }
        };
    } else if (chartType === 'line') {
        chartConfig.data.datasets[0] = {
            label: 'Hours',
            data: sortedSources.map(([,hours]) => hours),
            borderColor: '#28a745',
            backgroundColor: 'rgba(40, 167, 69, 0.1)',
            fill: true,
            tension: 0.4
        };
        chartConfig.options.scales = {
            y: { beginAtZero: true }
        };
    }

    charts.source = new Chart(ctx, chartConfig);
}

function createTicketChart(chartType) {
    const ticketHours = {};

    processedData.forEach(row => {
        const ticketId = row['Ticket ID'];
        const ticketName = row['Ticket Name'] || 'Unnamed';
        const hours = row['Logged Hours'] || 0;

        if (ticketId || row['Ticket Source'] === 'Manual Entry') {
            const key = ticketId ? `${ticketId} - ${ticketName}` : ticketName;
            ticketHours[key] = (ticketHours[key] || 0) + hours;
        }
    });

    const sortedTickets = Object.entries(ticketHours)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10);

    if (sortedTickets.length === 0) return;

    const ctx = document.getElementById('ticketChart').getContext('2d');
    charts.ticket = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sortedTickets.map(([name]) => {
                return name.length > 30 ? name.substring(0, 27) + '...' : name;
            }),
            datasets: [{
                label: 'Hours',
                data: sortedTickets.map(([,hours]) => hours),
                backgroundColor: getChartColors(sortedTickets.length),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Hours'
                    }
                },
                x: {
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45
                    }
                }
            }
        }
    });
}

function createDataTable() {
    const tableContent = document.getElementById('tableContent');

    let html = '<table>';
    html += '<thead><tr>';

    const headers = ['Task', 'Ticket ID', 'Ticket Name', 'Story Point', 'Logged Hours', 'Employees Involved', 'Ticket Source'];
    headers.forEach(header => {
        html += `<th>${header}</th>`;
    });
    html += '</tr></thead><tbody>';

    const sortedData = processedData
        .filter(row => (row['Logged Hours'] || 0) > 0)
        .sort((a, b) => (b['Logged Hours'] || 0) - (a['Logged Hours'] || 0))
        .slice(0, 50);

    sortedData.forEach(row => {
        html += '<tr>';
        headers.forEach(header => {
            let value = row[header] || '';

            if (header === 'Logged Hours') {
                value = (parseFloat(row[header]) || 0).toFixed(2);
            }
            if (header === 'Ticket Name' && value.length > 50) {
                value = value.substring(0, 47) + '...';
            }
            if (header === 'Consolidated Comments' && value.length > 100) {
                value = value.substring(0, 97) + '...';
            }

            html += `<td title="${String(row[header] || '').replace(/"/g, '&quot;')}">${value}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    tableContent.innerHTML = html;
}

// ==========================================
// DOWNLOAD FUNCTIONS
// ==========================================

function downloadCSV() {
    if (!processedData) {
        showError('No processed data available for download');
        return;
    }

    const headers = ['Task', 'Ticket ID', 'Ticket Name', 'Story Point', 'Logged Hours', 'Consolidated Comments', 'Employees Involved', 'Ticket Source'];

    let csvContent = headers.join(',') + '\n';

    processedData.forEach(row => {
        const csvRow = headers.map(header => {
            let value = row[header] || '';
            // Escape quotes and wrap in quotes if contains comma, quote, or newline
            if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
                value = '"' + value.replace(/"/g, '""') + '"';
            }
            return value;
        });
        csvContent += csvRow.join(',') + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${getFileBaseName()}_Consolidated_Report.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

function downloadJSON() {
    if (!processedData) {
        showError('No processed data available for download');
        return;
    }

    const jsonContent = JSON.stringify({
        summary: {
            originalRecords: rawData?.length || 0,
            consolidatedRecords: processedData.length,
            totalHours: processedData.reduce((sum, row) => sum + (row['Logged Hours'] || 0), 0),
            processedAt: new Date().toISOString()
        },
        data: processedData
    }, null, 2);

    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${getFileBaseName()}_Consolidated_Report.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// ==========================================
// EVENT LISTENERS
// ==========================================

// File input change handler
document.getElementById('fileInput').addEventListener('change', function() {
    const fileName = this.files[0]?.name || '';
    const label = document.querySelector('.file-input-label');
    if (fileName) {
        label.textContent = `📁 ${fileName}`;
    } else {
        label.textContent = '📁 Choose Timesheet File (.csv or .xlsx)';
    }
});

// Resource filter change handler
document.getElementById('resourceFilter').addEventListener('change', function() {
    if (processedData) {
        filterDataAndRefresh();
    }
});

// Chart type change handler
document.getElementById('chartType').addEventListener('change', function() {
    if (processedData) {
        filterDataAndRefresh();
    }
});

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('Timesheet Processor & Visualizer loaded successfully');
});
