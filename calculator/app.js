const express = require('express');
const axios = require('axios');
const app = express();
const port = 3000;

const WINDOW_SIZE = 10;
const TIMEOUT = 50000; // ms
const API_BASE_URL = 'http://20.244.56.144/evaluation-service';
const AUTH_BASE_URL = 'http://20.244.56.144/evaluation-service/auth';

const authCredentials = {
    email:"122cs0020@iiitk.ac.in",
        name:"nilesh sharma",
        rollNo:"122cs0020",
        accessCode:"bzbCnz",
        clientID:"9528cabd-36da-4c8c-918d-edbdf02b2d87",
        clientSecret:"AMWrAraqsZnwvVKE"
        
};

let authToken = null;
let tokenExpiry = 0;

const numberTypeToEndpoint = {
  'p': '/primes',
  'f': '/fibo',
  'e': '/even',
  'r': '/rand'
};

const numberWindows = {
  'p': [], 
  'f': [], 
  'e': [], 
  'r': [] 
};



app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    message: '122CS0020 - Nilesh Sharma - Average Calculator Microservice',
    
  });
});

app.get('/numbers/:numberId', async (req, res) => {
  const numberId = req.params.numberId;
  
  if (!['p', 'f', 'e', 'r'].includes(numberId)) {
    return res.status(400).json({ error: 'Invalid number ID. Use p, f, e, or r.' });
  }
  
  try {
    const windowPrevState = [...numberWindows[numberId]];
    
    const startTime = Date.now();
    const numbers = await fetchNumbersFromThirdParty(numberId);
    const endTime = Date.now();
    
    console.log(`Fetch for ${numberId} took ${endTime - startTime}ms`);
    
    updateNumberWindow(numberId, numbers);
    
    const avg = calculateAverage(numberWindows[numberId]);
    
    const response = {
      windowPrevState: windowPrevState,
      windowCurrState: numberWindows[numberId],
      numbers: numbers,
      avg: parseFloat(avg.toFixed(2))
    };
    
    res.json(response);
  } catch (error) {
    console.error(`Error processing request for ${numberId}:`, error.message);
    res.status(500).json({ error: 'Failed to process request', details: error.message });
  }
});

async function refreshAuthToken() {
  try {
    console.log('Refreshing authe] token...');
    
    const response = await axios.post(`${AUTH_BASE_URL}`, authCredentials, {
      timeout: 5000 
    });
    
    if (response.data && response.data.access_token) {
      authToken = response.data.access_token;
      
      tokenExpiry = response.data.expires_in || (Date.now() + 3600000);
      
      console.log('Refreshing authe token...');
      return authToken;
    } else {
      throw new Error('Invalid response from authentication server');
    }
  } catch (error) {
    console.error('Failed to refresh authentication token:', error.message);
    throw error;
  }
}


async function getValidToken() {
  if (!authToken || Date.now() >= tokenExpiry) {
    return await refreshAuthToken();
  }
  return authToken;
}

async function fetchNumbersFromThirdParty(numberId) {
  try {
    const token = await getValidToken();
    
    const endpoint = numberTypeToEndpoint[numberId];
    const url = `${API_BASE_URL}${endpoint}`;
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      },
      timeout: TIMEOUT
    });
    
    if (response.data && Array.isArray(response.data.numbers)) {
      return response.data.numbers;
    } else {
      console.log(`Invalid response format from ${url}:`, response.data);
      return fallbackData[numberId];
    }
  } catch (error) {
    if (error.response) {
      
      if (error.response.status === 401) {
        console.log('Token unauthorized. Trying to refresh token and retry...');
        
        try {
          authToken = null;
          const newToken = await getValidToken();
          
          const endpoint = numberTypeToEndpoint[numberId];
          const url = `${API_BASE_URL}${endpoint}`;
          
          const retryResponse = await axios.get(url, {
            headers: {
              'Authorization': `Bearer ${newToken}`
            },
            timeout: TIMEOUT
          });
          
          if (retryResponse.data && Array.isArray(retryResponse.data.numbers)) {
            return retryResponse.data.numbers;
          }
        } catch (retryError) {
          console.error('Retry after token refresh failed:', retryError.message);
        }
      } else {
        console.error(`API error (${error.response.status}):`, error.response.data);
      }
    } else if (error.request) {
      console.error('No response received from API:', error.message);
    } else {
      console.error('Error setting up request:', error.message);
    }
    
  
  }
}

function updateNumberWindow(numberId, newNumbers) {
  const window = numberWindows[numberId];
  
  // Add unique numbers
  for (const num of newNumbers) {
    if (!window.includes(num)) {
      window.push(num);
      
      if (window.length > WINDOW_SIZE) {
        window.shift();
      }
    }
  }
}


function calculateAverage(numbers) {
  if (numbers.length === 0) return 0;
  
  const sum = numbers.reduce((acc, num) => acc + num, 0);
  return sum / numbers.length;
}

// Start the server
app.listen(port, async () => {
  console.log(`Average Calculator microservice listening on port ${port}`);
  console.log(`Server running at http://localhost:${port}/`);
  console.log(`Connected to evaluation service at: ${API_BASE_URL}`);
  
  try {
    await getValidToken();
    console.log('Authentication successful');
  } catch (error) {
    console.warn('Authentication failed on startup. Will retry on first request.');
  }
  
  
});