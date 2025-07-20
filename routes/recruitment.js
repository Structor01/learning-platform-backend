const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const auth = require('../middleware/auth');
const axios = require('axios');

// GET /api/recruitment/jobs - Listar vagas
router.get('/jobs', auth, async (req, res) => {
  try {
    const query = `
      SELECT 
        id,
        title,
        company,
        location,
        job_type,
        experience_level,
        salary_range,
        description,
        requirements,
        benefits,
        status,
        created_at,
        created_by,
        applications_count,
        views_count
      FROM jobs 
      WHERE status = 'active'
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar vagas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/recruitment/jobs - Criar nova vaga
router.post('/jobs', auth, async (req, res) => {
  try {
    const {
      title,
      company,
      location,
      job_type,
      experience_level,
      salary_range,
      description,
      requirements,
      benefits,
      skills_required
    } = req.body;
    
    const query = `
      INSERT INTO jobs (
        title, company, location, job_type, experience_level,
        salary_range, description, requirements, benefits,
        skills_required, created_by, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
      RETURNING *
    `;
    
    const result = await pool.query(query, [
      title, company, location, job_type, experience_level,
      salary_range, description, requirements, benefits,
      JSON.stringify(skills_required), req.user.id
    ]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar vaga:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/recruitment/linkedin-search - Buscar candidatos no LinkedIn
router.post('/linkedin-search', auth, async (req, res) => {
  try {
    const { 
      job_id, 
      keywords, 
      location, 
      experience_level,
      skills,
      company_size,
      industry 
    } = req.body;
    
    // Simular busca no LinkedIn (em produção, usar LinkedIn API)
    const mockCandidates = generateMockLinkedInCandidates(keywords, location, skills);
    
    // Salvar busca no banco
    const searchQuery = `
      INSERT INTO linkedin_searches (
        job_id, keywords, location, experience_level,
        skills, company_size, industry, results_count,
        created_by, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING id
    `;
    
    const searchResult = await pool.query(searchQuery, [
      job_id, keywords, location, experience_level,
      JSON.stringify(skills), company_size, industry,
      mockCandidates.length, req.user.id
    ]);
    
    const searchId = searchResult.rows[0].id;
    
    // Salvar candidatos encontrados
    for (const candidate of mockCandidates) {
      await pool.query(`
        INSERT INTO linkedin_candidates (
          search_id, linkedin_url, name, title, company,
          location, experience_years, skills, summary,
          profile_image, contact_info, match_score
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        searchId, candidate.linkedin_url, candidate.name,
        candidate.title, candidate.company, candidate.location,
        candidate.experience_years, JSON.stringify(candidate.skills),
        candidate.summary, candidate.profile_image,
        JSON.stringify(candidate.contact_info), candidate.match_score
      ]);
    }
    
    res.json({
      search_id: searchId,
      candidates: mockCandidates,
      total_found: mockCandidates.length
    });
  } catch (error) {
    console.error('Erro na busca LinkedIn:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/recruitment/searches - Listar buscas realizadas
router.get('/searches', auth, async (req, res) => {
  try {
    const query = `
      SELECT 
        ls.*,
        j.title as job_title,
        j.company as job_company,
        COUNT(lc.id) as candidates_found
      FROM linkedin_searches ls
      LEFT JOIN jobs j ON ls.job_id = j.id
      LEFT JOIN linkedin_candidates lc ON ls.id = lc.search_id
      WHERE ls.created_by = $1
      GROUP BY ls.id, j.title, j.company
      ORDER BY ls.created_at DESC
    `;
    
    const result = await pool.query(query, [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar histórico:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/recruitment/searches/:id/candidates - Candidatos de uma busca
router.get('/searches/:id/candidates', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20, sort_by = 'match_score' } = req.query;
    
    const offset = (page - 1) * limit;
    
    const query = `
      SELECT 
        lc.*,
        ls.keywords,
        j.title as job_title
      FROM linkedin_candidates lc
      JOIN linkedin_searches ls ON lc.search_id = ls.id
      LEFT JOIN jobs j ON ls.job_id = j.id
      WHERE lc.search_id = $1
      ORDER BY ${sort_by} DESC
      LIMIT $2 OFFSET $3
    `;
    
    const result = await pool.query(query, [id, limit, offset]);
    
    // Contar total
    const countQuery = `
      SELECT COUNT(*) as total
      FROM linkedin_candidates
      WHERE search_id = $1
    `;
    const countResult = await pool.query(countQuery, [id]);
    
    res.json({
      candidates: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].total),
        pages: Math.ceil(countResult.rows[0].total / limit)
      }
    });
  } catch (error) {
    console.error('Erro ao buscar candidatos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/recruitment/candidates/:id/contact - Entrar em contato com candidato
router.post('/candidates/:id/contact', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { message, contact_type } = req.body;
    
    // Buscar candidato
    const candidateQuery = `
      SELECT lc.*, ls.job_id, j.title as job_title
      FROM linkedin_candidates lc
      JOIN linkedin_searches ls ON lc.search_id = ls.id
      LEFT JOIN jobs j ON ls.job_id = j.id
      WHERE lc.id = $1
    `;
    
    const candidateResult = await pool.query(candidateQuery, [id]);
    
    if (candidateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Candidato não encontrado' });
    }
    
    const candidate = candidateResult.rows[0];
    
    // Registrar contato
    const contactQuery = `
      INSERT INTO candidate_contacts (
        candidate_id, job_id, contact_type, message,
        contacted_by, contacted_at, status
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), 'sent')
      RETURNING *
    `;
    
    const contactResult = await pool.query(contactQuery, [
      id, candidate.job_id, contact_type, message, req.user.id
    ]);
    
    // Simular envio (em produção, integrar com LinkedIn/email)
    const contactResponse = await simulateLinkedInContact(candidate, message, contact_type);
    
    res.json({
      contact: contactResult.rows[0],
      response: contactResponse
    });
  } catch (error) {
    console.error('Erro ao contatar candidato:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/recruitment/analytics - Analytics de recrutamento
router.get('/analytics', auth, async (req, res) => {
  try {
    // Vagas por status
    const jobsQuery = `
      SELECT 
        status,
        COUNT(*) as count
      FROM jobs
      GROUP BY status
    `;
    
    // Candidatos por nível de experiência
    const candidatesQuery = `
      SELECT 
        experience_level,
        COUNT(*) as count,
        AVG(match_score) as avg_match_score
      FROM linkedin_candidates lc
      JOIN linkedin_searches ls ON lc.search_id = ls.id
      GROUP BY experience_level
    `;
    
    // Taxa de resposta
    const responseQuery = `
      SELECT 
        contact_type,
        COUNT(*) as total_contacts,
        COUNT(CASE WHEN status = 'responded' THEN 1 END) as responses,
        ROUND(
          COUNT(CASE WHEN status = 'responded' THEN 1 END) * 100.0 / COUNT(*), 
          2
        ) as response_rate
      FROM candidate_contacts
      GROUP BY contact_type
    `;
    
    // Buscas por mês
    const searchTrendQuery = `
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as searches,
        SUM(results_count) as total_candidates
      FROM linkedin_searches
      WHERE created_at >= NOW() - INTERVAL '12 months'
      GROUP BY month
      ORDER BY month
    `;
    
    const [jobsResult, candidatesResult, responseResult, trendResult] = await Promise.all([
      pool.query(jobsQuery),
      pool.query(candidatesQuery),
      pool.query(responseQuery),
      pool.query(searchTrendQuery)
    ]);
    
    res.json({
      jobsByStatus: jobsResult.rows,
      candidatesByExperience: candidatesResult.rows,
      responseRates: responseResult.rows,
      searchTrend: trendResult.rows
    });
  } catch (error) {
    console.error('Erro ao buscar analytics:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Função para gerar candidatos mock do LinkedIn
function generateMockLinkedInCandidates(keywords, location, skills) {
  const names = [
    'Ana Silva', 'Carlos Santos', 'Maria Oliveira', 'João Pereira',
    'Fernanda Costa', 'Ricardo Lima', 'Juliana Alves', 'Pedro Rodrigues',
    'Camila Ferreira', 'Lucas Martins', 'Beatriz Souza', 'Rafael Gomes'
  ];
  
  const companies = [
    'Syngenta', 'Bayer', 'Cargill', 'ADM', 'JBS', 'BRF',
    'Raízen', 'Suzano', 'Klabin', 'Fibria', 'Eldorado', 'Copacol'
  ];
  
  const titles = [
    'Engenheiro Agrônomo', 'Gerente de Vendas', 'Analista de Mercado',
    'Coordenador Técnico', 'Especialista em Sustentabilidade',
    'Gerente de Operações', 'Analista de Dados', 'Consultor Técnico'
  ];
  
  const candidates = [];
  const count = Math.floor(Math.random() * 15) + 10; // 10-25 candidatos
  
  for (let i = 0; i < count; i++) {
    const name = names[Math.floor(Math.random() * names.length)];
    const company = companies[Math.floor(Math.random() * companies.length)];
    const title = titles[Math.floor(Math.random() * titles.length)];
    
    candidates.push({
      linkedin_url: `https://linkedin.com/in/${name.toLowerCase().replace(' ', '-')}`,
      name: name,
      title: title,
      company: company,
      location: location || 'São Paulo, SP',
      experience_years: Math.floor(Math.random() * 15) + 2,
      skills: skills || ['Agronomia', 'Gestão', 'Vendas'],
      summary: `Profissional experiente em ${title.toLowerCase()} com foco em agronegócio e sustentabilidade.`,
      profile_image: `https://i.pravatar.cc/150?u=${name}`,
      contact_info: {
        email: `${name.toLowerCase().replace(' ', '.')}@${company.toLowerCase()}.com`,
        phone: `+55 11 9${Math.floor(Math.random() * 90000000) + 10000000}`
      },
      match_score: Math.floor(Math.random() * 40) + 60 // 60-100%
    });
  }
  
  return candidates.sort((a, b) => b.match_score - a.match_score);
}

// Função para simular contato no LinkedIn
async function simulateLinkedInContact(candidate, message, contact_type) {
  // Simular delay de envio
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const responses = [
    'Mensagem enviada com sucesso!',
    'Convite de conexão enviado.',
    'InMail enviado para o candidato.',
    'Mensagem agendada para envio.'
  ];
  
  return {
    status: 'success',
    message: responses[Math.floor(Math.random() * responses.length)],
    sent_at: new Date().toISOString(),
    estimated_delivery: new Date(Date.now() + 5 * 60 * 1000).toISOString()
  };
}

module.exports = router;

