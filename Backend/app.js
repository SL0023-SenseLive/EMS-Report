const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const bodyParser = require('body-parser');

const indexRoutes = require('./routes/indexRoutes'); 
const energyReportRoutes = require('./routes/energyReportRoutes');
const demandAnalysisRoutes = require('./routes/demandanalysisRoutes');
const powequalityRoutes=require('./routes/powequalityRoutes');
const app = express();
dotenv.config();
const PORT = process.env.PORT || 5000;

// CORS Configuration
const allowedOrigins = ['http://localhost:5000', 'http://localhost:4200']; // Update with your actual allowed origins

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  }
}));


app.use(express.json());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));



app.get('/test-connection', (req, res) => {
  console.log('Test connection endpoint hit');
  res.json({ message: 'Server is reachable' });
});


app.use('/api', energyReportRoutes);
app.use('/api', demandAnalysisRoutes); // Use the demand analysis routes
app.use('/api', indexRoutes); 
app.use('/api',powequalityRoutes);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
