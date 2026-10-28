const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files (HTML, CSS, JS, and the large opencv.js file)
app.use(express.static(__dirname));

// Route all requests to index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`Backend server running at http://localhost:${PORT}`);
    console.log(`OpenCV.js is now served locally from your machine!`);
    console.log(`=================================================`);
});
