const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const auth = require('../middleware/auth');

// GET /api/courses - Listar cursos
router.get('/', auth, async (req, res) => {
  try {
    const query = `
      SELECT 
        id, title, description, instructor, duration,
        category, level, rating, thumbnail, created_at
      FROM courses 
      WHERE status = 'active'
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar cursos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/courses/:id - Buscar curso específico
router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT * FROM courses WHERE id = $1 AND status = 'active'
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Curso não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao buscar curso:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;

