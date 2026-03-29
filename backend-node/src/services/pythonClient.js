import axios from 'axios';

const analyticsUrl = process.env.ANALYTICS_SERVICE_URL || 'http://localhost:8000';

export async function fetchTechnicalAnalysis(ticker, period) {
  const response = await axios.post(`${analyticsUrl}/analyze`, {
    ticker,
    period
  }, {
    timeout: 15000
  });

  return response.data;
}
