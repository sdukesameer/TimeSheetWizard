const https = require('https');

exports.handler = async (event, context) => {
  const { domain, ticketId, email, token } = event.queryStringParameters;

  if (!domain || !ticketId || !email || !token) {
    return {
      statusCode: 400,
      headers: { 
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "*"
      },
      body: JSON.stringify({ error: "Missing parameters" })
    };
  }

  return new Promise((resolve) => {
    const url = `https://${domain}/rest/api/3/issue/${ticketId}`;
    const auth = Buffer.from(`${email}:${token}`).toString('base64');

    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: { 
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type"
          },
          body: data
        });
      });
    });

    req.on('error', () => {
      resolve({
        statusCode: 500,
        headers: { 
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type"
        },
        body: JSON.stringify({ error: "Server error" })
      });
    });

    req.end();
  });
};
