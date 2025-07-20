const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const auth = require('../middleware/auth');

// GET /api/users/profile - Buscar perfil do usuário
router.get('/profile', auth, async (req, res) => {
  try {
    const query = `
      SELECT 
        id, name, email, phone, company, position,
        disc_profile, subscription_status, created_at,
        last_login, total_courses_completed, engagement_score
      FROM users 
      WHERE id = $1
    `;
    
    const result = await pool.query(query, [req.user.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao buscar perfil:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// PUT /api/users/profile - Atualizar perfil do usuário
router.put('/profile', auth, async (req, res) => {
  try {
    const { name, phone, company, position, disc_profile } = req.body;
    
    const query = `
      UPDATE users 
      SET 
        name = COALESCE($1, name),
        phone = COALESCE($2, phone),
        company = COALESCE($3, company),
        position = COALESCE($4, position),
        disc_profile = COALESCE($5, disc_profile),
        updated_at = NOW()
      WHERE id = $6
      RETURNING id, name, email, phone, company, position, disc_profile
    `;
    
    const result = await pool.query(query, [
      name, phone, company, position, disc_profile, req.user.id
    ]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar perfil:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;

