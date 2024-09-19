// Import dependencies
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();
const authenticateToken = require('./authMiddleware');
const path = require('path');

// Initialize Express app
const app = express();

// Middleware
app.use(cors({ origin: '*' })); // Enable CORS for all routes
app.use(express.json()); // Parse incoming JSON data

// Configure the PostgreSQL connection pool
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Health check route
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// User Registration Route
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ msg: 'All fields are required' });
  }

  try {
    const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ msg: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await pool.query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING *',
      [username, email, hashedPassword]
    );

    const token = jwt.sign({ userId: newUser.rows[0].id }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    res.status(201).json({ token, user: newUser.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// User Login Route
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ msg: 'Both email and password are required' });
  }

  try {
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) {
      return res.status(400).json({ msg: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.rows[0].password);
    if (!isMatch) {
      return res.status(400).json({ msg: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.rows[0].id }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    res.json({ token, user: user.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// CREATE: Add a new arcade
app.post('/api/arcades', authenticateToken, async (req, res) => {
  const { name, address, days_open, hours_of_operation, serves_alcohol } = req.body;

  try {
    const newArcade = await pool.query(
      'INSERT INTO arcades (name, address, days_open, hours_of_operation, serves_alcohol) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, address, days_open, hours_of_operation, serves_alcohol]
    );
    res.json(newArcade.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// READ: Get all arcades with average ratings
app.get('/api/arcades', async (req, res) => {
  try {
    const allArcades = await pool.query(`
      SELECT arcades.*, 
      COALESCE(ROUND(AVG(comments.rating), 1), 0) AS average_rating
      FROM arcades
      LEFT JOIN comments ON arcades.id = comments.arcade_id
      GROUP BY arcades.id
    `);
    res.json(allArcades.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// READ: Get a single arcade by ID
app.get('/api/arcades/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const arcade = await pool.query('SELECT * FROM arcades WHERE id = $1', [id]);
    
    if (arcade.rows.length === 0) {
      return res.status(404).json({ msg: 'Arcade not found' });
    }

    res.json(arcade.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// UPDATE: Edit an arcade
app.put('/api/arcades/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, address, days_open, hours_of_operation, serves_alcohol } = req.body;

  try {
    const updatedArcade = await pool.query(
      'UPDATE arcades SET name = $1, address = $2, days_open = $3, hours_of_operation = $4, serves_alcohol = $5 WHERE id = $6 RETURNING *',
      [name, address, days_open, hours_of_operation, serves_alcohol, id]
    );

    if (updatedArcade.rows.length === 0) {
      return res.status(404).json({ msg: 'Arcade not found' });
    }

    res.json(updatedArcade.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// DELETE: Delete an arcade
app.delete('/api/arcades/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const deletedArcade = await pool.query('DELETE FROM arcades WHERE id = $1 RETURNING *', [id]);

    if (deletedArcade.rows.length === 0) {
      return res.status(404).json({ msg: 'Arcade not found' });
    }

    res.json({ message: 'Arcade deleted successfully', arcade: deletedArcade.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// CREATE: Add a comment to an arcade
app.post('/api/arcades/:id/comments', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { comment, rating } = req.body;
  
  if (!comment || !rating) {
    return res.status(400).json({ msg: 'Both comment and rating are required' });
  }

  try {
    const newComment = await pool.query(
      `INSERT INTO comments (user_id, arcade_id, comment, rating) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, comment, rating, created_at, 
       (SELECT username FROM users WHERE id = $1) as username`,
      [req.user.userId, id, comment, rating]
    );

    res.json(newComment.rows[0]);
  } catch (err) {
    console.error('Error creating comment:', err);
    res.status
    res.status(500).send('Server error');
  }
});

// READ: Get reviews for the logged-in user
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userReviews = await pool.query(
      `SELECT comments.*, arcades.name as arcade_name
       FROM comments
       JOIN arcades ON comments.arcade_id = arcades.id
       WHERE comments.user_id = $1
       ORDER BY comments.created_at DESC`,
      [userId]
    );
    res.json({ comments: userReviews.rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// UPDATE: Edit a comment (requires authentication)
app.put('/api/comments/:commentId', authenticateToken, async (req, res) => {
  const { commentId } = req.params;
  const { comment, rating } = req.body;
  const userId = req.user.userId;

  try {
    const updatedComment = await pool.query(
      'UPDATE comments SET comment = $1, rating = $2 WHERE id = $3 AND user_id = $4 RETURNING *',
      [comment, rating, commentId, userId]
    );

    if (updatedComment.rows.length === 0) {
      return res.status(404).json({ msg: 'Comment not found or not authorized' });
    }

    res.json(updatedComment.rows[0]);
  } catch (err) {
    console.error('Error updating comment:', err);
    res.status(500).send('Server error');
  }
});

// DELETE: Delete a comment (requires authentication)
app.delete('/api/comments/:commentId', authenticateToken, async (req, res) => {
  const { commentId } = req.params;
  const userId = req.user.userId;

  try {
    const deletedComment = await pool.query(
      'DELETE FROM comments WHERE id = $1 AND user_id = $2 RETURNING *',
      [commentId, userId]
    );

    if (deletedComment.rows.length === 0) {
      return res.status(404).json({ msg: 'Comment not found or not authorized' });
    }

    res.json({ message: 'Comment deleted successfully', comment: deletedComment.rows[0] });
  } catch (err) {
    console.error('Error deleting comment:', err);
    res.status(500).send('Server error');
  }
});

// Serve static files from React frontend (after the API routes)
app.use(express.static(path.join(__dirname, 'client/build')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname + '/client/build/index.html'));
});

// Test database connection
app.get('/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM arcades;');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Database query failed');
  }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
