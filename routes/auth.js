const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

// POST /api/auth/login - Login do usuário
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }
    
    // Buscar usuário
    const userQuery = 'SELECT * FROM users WHERE email = $1';
    const userResult = await pool.query(userQuery, [email]);
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }
    
    const user = userResult.rows[0];
    
    // Verificar senha (assumindo que está em texto plano por enquanto)
    const isValidPassword = password === user.password || await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }
    
    // Gerar token JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // Atualizar último login
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
    
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        disc_profile: user.disc_profile,
        subscription_status: user.subscription_status
      }
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/auth/register - Registro de usuário
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone, company, position } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }
    
    // Verificar se usuário já existe
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Usuário já existe com este email' });
    }
    
    // Hash da senha
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Inserir usuário
    const insertQuery = `
      INSERT INTO users (name, email, password, phone, company, position, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING id, name, email, disc_profile, subscription_status
    `;
    
    const result = await pool.query(insertQuery, [
      name, email, hashedPassword, phone, company, position
    ]);
    
    const user = result.rows[0];
    
    // Gerar token JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.status(201).json({
      token,
      user
    });
  } catch (error) {
    console.error('Erro no registro:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;

