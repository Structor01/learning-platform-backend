const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const auth = require('../middleware/auth');

// GET /api/crm/leads - Listar todos os leads/clientes
router.get('/leads', auth, async (req, res) => {
  try {
    const query = `
      SELECT 
        id,
        name,
        email,
        phone,
        company,
        position,
        disc_profile,
        created_at,
        last_login,
        subscription_status,
        total_courses_completed,
        engagement_score,
        lead_source,
        lead_status,
        assigned_to,
        notes
      FROM users 
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query);
    
    // Classificar leads automaticamente
    const leadsWithClassification = result.rows.map(user => {
      let classification = 'Cold Lead';
      let priority = 'Low';
      
      // Lógica de classificação baseada em engajamento
      if (user.subscription_status === 'active') {
        classification = 'Customer';
        priority = 'High';
      } else if (user.total_courses_completed > 0) {
        classification = 'Warm Lead';
        priority = 'Medium';
      } else if (user.last_login && new Date(user.last_login) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) {
        classification = 'Hot Lead';
        priority = 'High';
      }
      
      return {
        ...user,
        classification,
        priority,
        engagement_level: user.engagement_score || 0
      };
    });
    
    res.json(leadsWithClassification);
  } catch (error) {
    console.error('Erro ao buscar leads:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/crm/leads/:id - Buscar lead específico
router.get('/leads/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT 
        u.*,
        COUNT(uc.id) as total_courses,
        AVG(uc.progress) as avg_progress,
        MAX(uc.last_accessed) as last_course_access
      FROM users u
      LEFT JOIN user_courses uc ON u.id = uc.user_id
      WHERE u.id = $1
      GROUP BY u.id
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead não encontrado' });
    }
    
    const lead = result.rows[0];
    
    // Buscar histórico de atividades
    const activityQuery = `
      SELECT 
        'login' as type,
        last_login as date,
        'Login na plataforma' as description
      FROM users WHERE id = $1 AND last_login IS NOT NULL
      UNION ALL
      SELECT 
        'course_enrollment' as type,
        uc.enrolled_at as date,
        CONCAT('Inscrito no curso: ', c.title) as description
      FROM user_courses uc
      JOIN courses c ON uc.course_id = c.id
      WHERE uc.user_id = $1
      ORDER BY date DESC
      LIMIT 10
    `;
    
    const activityResult = await pool.query(activityQuery, [id]);
    
    res.json({
      ...lead,
      activities: activityResult.rows
    });
  } catch (error) {
    console.error('Erro ao buscar lead:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// PUT /api/crm/leads/:id - Atualizar informações do lead
router.put('/leads/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      lead_status, 
      assigned_to, 
      notes, 
      lead_source,
      company,
      position,
      phone
    } = req.body;
    
    const query = `
      UPDATE users 
      SET 
        lead_status = COALESCE($1, lead_status),
        assigned_to = COALESCE($2, assigned_to),
        notes = COALESCE($3, notes),
        lead_source = COALESCE($4, lead_source),
        company = COALESCE($5, company),
        position = COALESCE($6, position),
        phone = COALESCE($7, phone),
        updated_at = NOW()
      WHERE id = $8
      RETURNING *
    `;
    
    const result = await pool.query(query, [
      lead_status, assigned_to, notes, lead_source, 
      company, position, phone, id
    ]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar lead:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/crm/analytics - Analytics do CRM
router.get('/analytics', auth, async (req, res) => {
  try {
    // Total de leads por status
    const statusQuery = `
      SELECT 
        CASE 
          WHEN subscription_status = 'active' THEN 'Customer'
          WHEN total_courses_completed > 0 THEN 'Warm Lead'
          WHEN last_login > NOW() - INTERVAL '7 days' THEN 'Hot Lead'
          ELSE 'Cold Lead'
        END as status,
        COUNT(*) as count
      FROM users
      GROUP BY status
    `;
    
    const statusResult = await pool.query(statusQuery);
    
    // Leads por fonte
    const sourceQuery = `
      SELECT 
        COALESCE(lead_source, 'Unknown') as source,
        COUNT(*) as count
      FROM users
      GROUP BY lead_source
      ORDER BY count DESC
    `;
    
    const sourceResult = await pool.query(sourceQuery);
    
    // Conversão por mês
    const conversionQuery = `
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as total_leads,
        COUNT(CASE WHEN subscription_status = 'active' THEN 1 END) as converted
      FROM users
      WHERE created_at >= NOW() - INTERVAL '12 months'
      GROUP BY month
      ORDER BY month
    `;
    
    const conversionResult = await pool.query(conversionQuery);
    
    // Top performers (vendedores)
    const performersQuery = `
      SELECT 
        assigned_to,
        COUNT(*) as total_leads,
        COUNT(CASE WHEN subscription_status = 'active' THEN 1 END) as converted_leads,
        ROUND(
          COUNT(CASE WHEN subscription_status = 'active' THEN 1 END) * 100.0 / COUNT(*), 
          2
        ) as conversion_rate
      FROM users
      WHERE assigned_to IS NOT NULL
      GROUP BY assigned_to
      ORDER BY conversion_rate DESC
    `;
    
    const performersResult = await pool.query(performersQuery);
    
    res.json({
      leadsByStatus: statusResult.rows,
      leadsBySource: sourceResult.rows,
      conversionTrend: conversionResult.rows,
      topPerformers: performersResult.rows
    });
  } catch (error) {
    console.error('Erro ao buscar analytics:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/crm/leads/:id/activity - Adicionar atividade ao lead
router.post('/leads/:id/activity', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { type, description, date } = req.body;
    
    const query = `
      INSERT INTO lead_activities (user_id, type, description, date, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    
    const result = await pool.query(query, [
      id, type, description, date || new Date(), req.user.id
    ]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao adicionar atividade:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/crm/pipeline - Pipeline de vendas
router.get('/pipeline', auth, async (req, res) => {
  try {
    const query = `
      SELECT 
        lead_status,
        COUNT(*) as count,
        AVG(engagement_score) as avg_engagement,
        SUM(CASE WHEN subscription_status = 'active' THEN 29.90 ELSE 0 END) as revenue
      FROM users
      WHERE lead_status IS NOT NULL
      GROUP BY lead_status
      ORDER BY 
        CASE lead_status
          WHEN 'new' THEN 1
          WHEN 'contacted' THEN 2
          WHEN 'qualified' THEN 3
          WHEN 'proposal' THEN 4
          WHEN 'negotiation' THEN 5
          WHEN 'closed_won' THEN 6
          WHEN 'closed_lost' THEN 7
          ELSE 8
        END
    `;
    
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar pipeline:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;

