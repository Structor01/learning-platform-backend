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

// POST /api/recruitment/jobs/generate-with-ai - Gerar vaga com IA
router.post('/jobs/generate-with-ai', auth, async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Prompt é obrigatório' });
    }
    
    console.log('🤖 Gerando vaga com IA para prompt:', prompt);
    
    // Gerar vaga com ChatGPT
    const jobData = await generateJobWithAI(prompt);
    
    // Salvar vaga no banco
    const query = `
      INSERT INTO jobs (
        title, company, location, job_type, experience_level,
        salary_range, description, requirements, benefits,
        skills_required, created_by, status, created_via_ai
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', true)
      RETURNING *
    `;
    
    const result = await pool.query(query, [
      jobData.title,
      jobData.company,
      jobData.location,
      jobData.job_type,
      jobData.experience_level,
      jobData.salary_range,
      jobData.description,
      jobData.requirements,
      jobData.benefits,
      JSON.stringify(jobData.skills_required),
      req.user.id
    ]);
    
    const createdJob = result.rows[0];
    
    // Criar perguntas customizadas se fornecidas
    if (jobData.custom_questions && jobData.custom_questions.length > 0) {
      for (let i = 0; i < jobData.custom_questions.length; i++) {
        await pool.query(`
          INSERT INTO job_interview_questions (job_id, question_number, question_text, created_by)
          VALUES ($1, $2, $3, $4)
        `, [createdJob.id, i + 1, jobData.custom_questions[i], req.user.id]);
      }
    }
    
    res.status(201).json({
      job: createdJob,
      ai_generated: true,
      custom_questions: jobData.custom_questions || [],
      prompt_used: prompt
    });
  } catch (error) {
    console.error('Erro ao gerar vaga com IA:', error);
    res.status(500).json({ 
      error: 'Erro ao gerar vaga com IA',
      fallback_available: true
    });
  }
});

// POST /api/recruitment/jobs/:id/suggest-improvements - Sugerir melhorias na vaga
router.post('/jobs/:id/suggest-improvements', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Buscar vaga atual
    const jobQuery = `
      SELECT * FROM jobs WHERE id = $1
    `;
    const jobResult = await pool.query(jobQuery, [id]);
    
    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Vaga não encontrada' });
    }
    
    const job = jobResult.rows[0];
    
    // Gerar sugestões com IA
    const suggestions = await generateJobImprovements(job);
    
    res.json({
      job_id: id,
      current_job: job,
      suggestions: suggestions,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Erro ao gerar sugestões:', error);
    res.status(500).json({ error: 'Erro ao gerar sugestões' });
  }
});

// GET /api/recruitment/jobs/:id/questions - Obter perguntas da vaga
router.get('/jobs/:id/questions', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Buscar perguntas específicas da vaga
    const customQuery = `
      SELECT * FROM job_interview_questions 
      WHERE job_id = $1 
      ORDER BY question_number
    `;
    
    // Buscar perguntas padrão
    const defaultQuery = `
      SELECT * FROM job_interview_questions 
      WHERE job_id IS NULL AND is_default = true
      ORDER BY question_number
    `;
    
    const [customResult, defaultResult] = await Promise.all([
      pool.query(customQuery, [id]),
      pool.query(defaultQuery)
    ]);
    
    const questions = customResult.rows.length > 0 ? customResult.rows : defaultResult.rows;
    
    res.json({
      job_id: id,
      questions: questions,
      is_custom: customResult.rows.length > 0
    });
  } catch (error) {
    console.error('Erro ao buscar perguntas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Função para gerar vaga com IA (ChatGPT)
async function generateJobWithAI(prompt) {
  try {
    // Verificar se tem API key do OpenAI
    if (!process.env.OPENAI_API_KEY) {
      console.log('⚠️ OPENAI_API_KEY não configurada, usando fallback');
      return generateJobFallback(prompt);
    }
    
    const systemPrompt = `Você é um especialista em recrutamento e RH. Baseado no prompt do usuário, gere uma vaga de emprego completa e profissional.

Retorne APENAS um JSON válido com esta estrutura:
{
  "title": "Título da vaga",
  "company": "Nome da empresa (se não especificado, use 'Empresa Confidencial')",
  "location": "Localização (se não especificado, use 'São Paulo, SP')",
  "job_type": "full-time|part-time|contract|internship",
  "experience_level": "entry|mid|senior|executive",
  "salary_range": "Faixa salarial em R$",
  "description": "Descrição detalhada da vaga (2-3 parágrafos)",
  "requirements": "Requisitos necessários (lista em texto)",
  "benefits": "Benefícios oferecidos (lista em texto)",
  "skills_required": ["skill1", "skill2", "skill3"],
  "custom_questions": ["Pergunta 1", "Pergunta 2", "Pergunta 3"]
}

Regras:
- Seja específico e profissional
- Use valores de salário realistas para o mercado brasileiro
- Inclua 3-5 skills relevantes
- Crie 3 perguntas específicas para a vaga
- Se o prompt mencionar tecnologias, inclua-as nos requisitos e skills`;

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1500,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const content = response.data.choices[0].message.content.trim();
    
    // Tentar fazer parse do JSON
    try {
      const jobData = JSON.parse(content);
      console.log('✅ Vaga gerada com ChatGPT:', jobData.title);
      return jobData;
    } catch (parseError) {
      console.log('⚠️ Erro no parse do JSON do ChatGPT, usando fallback');
      return generateJobFallback(prompt);
    }
  } catch (error) {
    console.log('⚠️ Erro na API do ChatGPT, usando fallback:', error.message);
    return generateJobFallback(prompt);
  }
}

// Função de fallback para gerar vaga sem IA
function generateJobFallback(prompt) {
  // Extrair informações básicas do prompt
  const lowerPrompt = prompt.toLowerCase();
  
  // Detectar tecnologias/skills
  const techKeywords = ['python', 'javascript', 'react', 'node', 'java', 'php', 'sql', 'aws', 'docker'];
  const detectedTechs = techKeywords.filter(tech => lowerPrompt.includes(tech));
  
  // Detectar nível
  let experienceLevel = 'mid';
  if (lowerPrompt.includes('junior') || lowerPrompt.includes('entry')) experienceLevel = 'entry';
  if (lowerPrompt.includes('senior') || lowerPrompt.includes('sênior')) experienceLevel = 'senior';
  if (lowerPrompt.includes('lead') || lowerPrompt.includes('manager')) experienceLevel = 'executive';
  
  // Detectar área
  let area = 'Tecnologia';
  if (lowerPrompt.includes('vendas') || lowerPrompt.includes('comercial')) area = 'Vendas';
  if (lowerPrompt.includes('marketing')) area = 'Marketing';
  if (lowerPrompt.includes('rh') || lowerPrompt.includes('recursos humanos')) area = 'Recursos Humanos';
  
  const salaryRanges = {
    entry: 'R$ 3.000 - R$ 5.000',
    mid: 'R$ 5.000 - R$ 8.000',
    senior: 'R$ 8.000 - R$ 12.000',
    executive: 'R$ 12.000 - R$ 20.000'
  };
  
  return {
    title: `Profissional de ${area} ${experienceLevel === 'senior' ? 'Sênior' : experienceLevel === 'entry' ? 'Júnior' : ''}`,
    company: 'Empresa Confidencial',
    location: 'São Paulo, SP',
    job_type: 'full-time',
    experience_level: experienceLevel,
    salary_range: salaryRanges[experienceLevel],
    description: `Estamos buscando um profissional de ${area} para integrar nossa equipe. A pessoa será responsável por contribuir com projetos inovadores e trabalhar em um ambiente colaborativo e dinâmico.`,
    requirements: `Experiência na área de ${area}, conhecimento em ${detectedTechs.join(', ') || 'ferramentas relevantes'}, boa comunicação e trabalho em equipe.`,
    benefits: 'Plano de saúde, vale refeição, home office flexível, participação nos lucros.',
    skills_required: detectedTechs.length > 0 ? detectedTechs : [area, 'Comunicação', 'Trabalho em equipe'],
    custom_questions: [
      `Conte sobre sua experiência em ${area}.`,
      'Como você se mantém atualizado com as tendências da área?',
      'Descreva um projeto desafiador que você trabalhou.'
    ]
  };
}

// Função para gerar sugestões de melhoria
async function generateJobImprovements(job) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return generateImprovementsFallback(job);
    }
    
    const prompt = `Analise esta vaga de emprego e sugira melhorias específicas:

Título: ${job.title}
Empresa: ${job.company}
Descrição: ${job.description}
Requisitos: ${job.requirements}
Benefícios: ${job.benefits}

Retorne um JSON com sugestões de melhoria:
{
  "title_suggestions": ["sugestão 1", "sugestão 2"],
  "description_improvements": ["melhoria 1", "melhoria 2"],
  "requirements_suggestions": ["sugestão 1", "sugestão 2"],
  "benefits_additions": ["benefício 1", "benefício 2"],
  "overall_score": 8.5,
  "main_issues": ["problema 1", "problema 2"]
}`;

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const content = response.data.choices[0].message.content.trim();
    return JSON.parse(content);
  } catch (error) {
    console.log('⚠️ Erro ao gerar sugestões, usando fallback');
    return generateImprovementsFallback(job);
  }
}

// Fallback para sugestões de melhoria
function generateImprovementsFallback(job) {
  return {
    title_suggestions: [
      'Considere ser mais específico sobre o nível de senioridade',
      'Adicione a área ou departamento no título'
    ],
    description_improvements: [
      'Inclua mais detalhes sobre as responsabilidades diárias',
      'Mencione oportunidades de crescimento e desenvolvimento'
    ],
    requirements_suggestions: [
      'Separe requisitos obrigatórios dos desejáveis',
      'Seja mais específico sobre anos de experiência'
    ],
    benefits_additions: [
      'Considere adicionar benefícios de desenvolvimento profissional',
      'Mencione cultura da empresa e ambiente de trabalho'
    ],
    overall_score: 7.5,
    main_issues: [
      'Descrição poderia ser mais detalhada',
      'Benefícios poderiam ser mais atrativos'
    ]
  };
}

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

