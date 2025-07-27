const https = require('https');

exports.handler = async (event, context) => {
  const { itemIds } = event.queryStringParameters;

  if (!itemIds) {
    return {
      statusCode: 400,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Missing itemIds parameter" })
    };
  }

  const apiKey = process.env.MONDAY_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Monday.com API key not configured" })
    };
  }

  const query = `
    query {
      items(ids: ${itemIds}) {
        id
        name
        column_values(ids: ["numbers"]) {
          value
        }
      }
    }
  `;

  const postData = JSON.stringify({ query });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.monday.com',
      path: '/v2',
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: { "Access-Control-Allow-Origin": "*" },
          body: data
        });
      });
    });

    req.on('error', () => {
      resolve({
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Server error" })
      });
    });

    req.write(postData);
    req.end();
  });
};