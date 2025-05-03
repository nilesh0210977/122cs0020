const express = require('express');
const axios = require('axios');
const app = express();
const port = 3000;

const API_BASE_URL = 'http://20.244.56.144/evaluation-service';
const AUTH_URL = 'http://20.244.56.144/evaluation-service/auth';

const authCredentials = {
    email: "122cs0020@iiitk.ac.in",
    name: "nilesh sharma",
    rollNo: "122cs0020",
    accessCode: "bzbCnz",
    clientID: "9528cabd-36da-4c8c-918d-edbdf02b2d87",
    clientSecret: "AMWrAraqsZnwvVKE"
};

let authToken = null;
let tokenExpiry = 0;

const cache = {
    users: { data: null, timestamp: 0 },
    posts: { data: null, timestamp: 0, type: null },
    comments: { data: {}, timestamp: 0 }
};

const CACHE_TTL = 30000;

app.use(express.json());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
        return res.status(200).json({});
    }
    next();
});

app.get('/', (_, res) => {
    res.json({
        message: 'Social App Analytics HTTP Microservice',
    
    });
});

app.get('/users', async (_, res) => {
    try {
        if (cache.users.data && Date.now() - cache.users.timestamp < CACHE_TTL) {
            return res.json(cache.users.data);
        }
        const users = await fetchUsers();
        const usersWithCommentCounts = await calculateUserCommentCounts(users);

        const sortedUsers = usersWithCommentCounts.sort((a, b) => b.totalComments - a.totalComments);

        const topUsers = sortedUsers.slice(0, 5);

        cache.users.data = topUsers;
        cache.users.timestamp = Date.now();

        res.json(topUsers);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch top users', details: error.message });
    }
});

app.get('/posts', async (req, res) => {
    try {
        const type = req.query.type || 'popular';
        if (!['latest', 'popular'].includes(type)) {
            return res.status(400).json({ error: 'Invalid type parameter. Use "latest" or "popular".' });
        }

        if (cache.posts.data && cache.posts.type === type && Date.now() - cache.posts.timestamp < CACHE_TTL) {
            return res.json(cache.posts.data);
        }

        const posts = await fetchAllPostsWithCommentCounts();

        let result;
        if (type === 'popular') {
            const maxComments = Math.max(...posts.map(post => post.commentCount));

            result = posts.filter(post => post.commentCount === maxComments);
        } else if (type === 'latest') {
            result = posts.sort((a, b) => b.id - a.id).slice(0, 5);
        }

        cache.posts.data = result;
        cache.posts.timestamp = Date.now();
        cache.posts.type = type;

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: `Failed to fetch ${req.query.type} posts`, details: error.message });
    }
});

async function refreshAuthToken() {
    try {
        const response = await axios.post(AUTH_URL, authCredentials, {
            timeout: 5000
        });
        if (response.data && response.data.access_token) {
            authToken = response.data.access_token;
            tokenExpiry = response.data.expires_in || (Date.now() + 3600000);
            return authToken;
        } else {
            throw new Error('Invalid response from authentication server');
        }
    } catch (error) {
        throw error;
    }
}

async function getValidToken() {
    if (!authToken || Date.now() >= tokenExpiry) {
        return await refreshAuthToken();
    }
    return authToken;
}

async function makeAuthenticatedRequest(endpoint) {
    try {
        const token = await getValidToken();
        const response = await axios.get(`${API_BASE_URL}${endpoint}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        return response.data;
    } catch (error) {
        if (error.response && error.response.status === 401) {
            authToken = null;
            const newToken = await getValidToken();
            const retryResponse = await axios.get(`${API_BASE_URL}${endpoint}`, {
                headers: {
                    'Authorization': `Bearer ${newToken}`
                }
            });

            return retryResponse.data;
        }

        throw error;
    }
}

async function fetchUsers() {
    const data = await makeAuthenticatedRequest('/users');
    // Ensure we always return an array
    return Array.isArray(data) ? data : [];
}

async function fetchUserPosts(userId) {
    const data = await makeAuthenticatedRequest(`/users/${userId}/posts`);
    return data;
}

async function fetchPostComments(postId) {
    if (cache.comments.data[postId] && Date.now() - cache.comments.timestamp < CACHE_TTL) {
        return cache.comments.data[postId];
    }

    const data = await makeAuthenticatedRequest(`/posts/${postId}/comments`);

    if (!cache.comments.data) {
        cache.comments.data = {};
    }
    cache.comments.data[postId] = data;
    cache.comments.timestamp = Date.now();

    return data;
}

async function fetchAllPostsWithCommentCounts() {
    const users = await fetchUsers();

    const allPostsPromises = users.map(user => fetchUserPosts(user.id));
    const allUsersPosts = await Promise.all(allPostsPromises);

    const allPosts = allUsersPosts.flat();

    const postsWithCommentsPromises = allPosts.map(async (post) => {
        const comments = await fetchPostComments(post.id);
        return {
            ...post,
            commentCount: comments.length
        };
    });

    return Promise.all(postsWithCommentsPromises);
}

async function calculateUserCommentCounts(users) {
    const usersWithCommentsPromises = users.map(async (user) => {
        const posts = await fetchUserPosts(user.id);
        let totalComments = 0;
        for (const post of posts) {
            const comments = await fetchPostComments(post.id);
            totalComments += comments.length;
        }

        return {
            ...user,
            totalComments,
            postCount: posts.length
        };
    });

    return Promise.all(usersWithCommentsPromises);
}

app.listen(port, async () => {
    console.log(`social app microservice listening on port ${port}`);
    try {
        await getValidToken();
    } catch (error) {
        console.warn('Authentication failed on startup. Will retry on first request.');
    }
});