const http = require('http');

const data = JSON.stringify({
  productId: '666666666666666666666666', // mock productId
  quantity: 1,
  mockCreditCard: '1234'
});

const options = {
  hostname: 'localhost',
  port: 5001,
  path: '/api/orders',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => console.log('Status:', res.statusCode, 'Body:', body));
});

req.on('error', e => console.error(e));
req.write(data);
req.end();
