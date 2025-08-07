const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const auth = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');

// Configuração do multer para upload de vídeos
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/interviews');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `interview-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos de vídeo são permitidos'));
    }
  }
});

// GET /api/interviews - Listar entrevistas
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, job_id } = req.query;
    const offset = (page - 1) * limit;
    
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    if (status) {
      whereClause += ` AND i.status = $${params.length + 1}`;
      params.push(status);
    }
    
    if (job_id) {
      whereClause += ` AND i.job_id = $${params.length + 1}`;
      params.push(job_id);
    }
    
    const query = `
      SELECT 
        i.*,
        j.title as job_title,
        j.company as job_company,
        COUNT(ir.id) as total_responses,
        COUNT(CASE WHEN ir.processing_status = 'completed' THEN 1 END) as completed_responses
      FROM interviews i
      LEFT JOIN jobs j ON i.job_id = j.id
      LEFT JOIN interview_responses ir ON i.id = ir.interview_id
      ${whereClause}
      GROUP BY i.id, j.title, j.company
      ORDER BY i.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    
    params.push(limit, offset);
    const result = await pool.query(query, params);
    
    // Contar total
    const countQuery = `
      SELECT COUNT(DISTINCT i.id) as total
      FROM interviews i
      LEFT JOIN jobs j ON i.job_id = j.id
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, params.slice(0, -2));
    
    res.json({
      interviews: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].total),
        pages: Math.ceil(countResult.rows[0].total / limit)
      }
    });
  } catch (error) {
    console.error('Erro ao buscar entrevistas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/interviews - Criar nova entrevista
router.post('/', auth, async (req, res) => {
  try {
    const {
      job_id,
      candidate_name,
      candidate_email,
      total_questions = 5
    } = req.body;
    
    const query = `
      INSERT INTO interviews (
        job_id, candidate_name, candidate_email, 
        total_questions, created_by
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    
    const result = await pool.query(query, [
      job_id, candidate_name, candidate_email,
      total_questions, req.user.id
    ]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar entrevista:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/interviews/:id - Obter entrevista específica
router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT 
        i.*,
        j.title as job_title,
        j.company as job_company,
        j.description as job_description
      FROM interviews i
      LEFT JOIN jobs j ON i.job_id = j.id
      WHERE i.id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Entrevista não encontrada' });
    }
    
    // Buscar respostas da entrevista
    const responsesQuery = `
      SELECT *
      FROM interview_responses
      WHERE interview_id = $1
      ORDER BY question_number
    `;
    
    const responsesResult = await pool.query(responsesQuery, [id]);
    
    res.json({
      interview: result.rows[0],
      responses: responsesResult.rows
    });
  } catch (error) {
    console.error('Erro ao buscar entrevista:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/interviews/:id/responses - Adicionar resposta à entrevista
router.post('/:id/responses', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      question_number,
      question_text,
      transcription,
      facial_data
    } = req.body;
    
    const query = `
      INSERT INTO interview_responses (
        interview_id, question_number, question_text,
        transcription, facial_data, processing_status
      )
      VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING *
    `;
    
    const result = await pool.query(query, [
      id, question_number, question_text,
      transcription, JSON.stringify(facial_data)
    ]);
    
    // Atualizar contador de respostas na entrevista
    await pool.query(`
      UPDATE interviews 
      SET answered_questions = answered_questions + 1
      WHERE id = $1
    `, [id]);
    
    // Processar resposta em background (simular)
    processResponseInBackground(result.rows[0]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao adicionar resposta:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/interviews/:id/upload-video - Upload de vídeo da entrevista
router.post('/:id/upload-video', auth, upload.single('video'), async (req, res) => {
  try {
    const { id } = req.params;
    const { response_id } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo de vídeo enviado' });
    }
    
    const videoUrl = `/uploads/interviews/${req.file.filename}`;
    
    if (response_id) {
      // Associar vídeo a uma resposta específica
      await pool.query(`
        UPDATE interview_responses 
        SET video_blob_url = $1
        WHERE id = $2 AND interview_id = $3
      `, [videoUrl, response_id, id]);
    } else {
      // Associar vídeo à entrevista geral
      await pool.query(`
        UPDATE interviews 
        SET video_url = $1
        WHERE id = $2
      `, [videoUrl, id]);
    }
    
    res.json({
      message: 'Vídeo enviado com sucesso',
      video_url: videoUrl,
      file_size: req.file.size,
      duration: req.body.duration || null
    });
  } catch (error) {
    console.error('Erro no upload de vídeo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// PUT /api/interviews/:id/complete - Finalizar entrevista
router.put('/:id/complete', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { final_report } = req.body;
    
    // Calcular score geral baseado nas respostas
    const scoresQuery = `
      SELECT AVG(analysis_score) as avg_score
      FROM interview_responses
      WHERE interview_id = $1 AND analysis_score IS NOT NULL
    `;
    
    const scoresResult = await pool.query(scoresQuery, [id]);
    const overallScore = scoresResult.rows[0].avg_score || null;
    
    // Contar dados faciais
    const facialQuery = `
      SELECT COUNT(*) as facial_count
      FROM facial_analysis_data
      WHERE interview_id = $1
    `;
    
    const facialResult = await pool.query(facialQuery, [id]);
    const facialDataPoints = facialResult.rows[0].facial_count || 0;
    
    const query = `
      UPDATE interviews 
      SET 
        status = 'completed',
        overall_score = $1,
        facial_data_points = $2,
        final_report = $3,
        completed_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `;
    
    const result = await pool.query(query, [
      overallScore, facialDataPoints, final_report, id
    ]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao finalizar entrevista:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/interviews/:id/analytics - Analytics da entrevista
router.get('/:id/analytics', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Dados básicos da entrevista
    const interviewQuery = `
      SELECT 
        i.*,
        j.title as job_title,
        AVG(ir.analysis_score) as avg_score,
        COUNT(ir.id) as total_responses,
        COUNT(CASE WHEN ir.processing_status = 'completed' THEN 1 END) as completed_responses
      FROM interviews i
      LEFT JOIN jobs j ON i.job_id = j.id
      LEFT JOIN interview_responses ir ON i.id = ir.interview_id
      WHERE i.id = $1
      GROUP BY i.id, j.title
    `;
    
    // Dados comportamentais agregados
    const behavioralQuery = `
      SELECT 
        AVG(confidence) as avg_confidence,
        COUNT(*) as total_samples,
        AVG((emotions->>'happy')::float) as avg_happiness,
        AVG((emotions->>'neutral')::float) as avg_neutral,
        AVG((emotions->>'sad')::float) as avg_sadness
      FROM facial_analysis_data
      WHERE interview_id = $1
    `;
    
    // Scores por pergunta
    const scoresQuery = `
      SELECT 
        question_number,
        question_text,
        analysis_score,
        processing_status
      FROM interview_responses
      WHERE interview_id = $1
      ORDER BY question_number
    `;
    
    const [interviewResult, behavioralResult, scoresResult] = await Promise.all([
      pool.query(interviewQuery, [id]),
      pool.query(behavioralQuery, [id]),
      pool.query(scoresQuery, [id])
    ]);
    
    if (interviewResult.rows.length === 0) {
      return res.status(404).json({ error: 'Entrevista não encontrada' });
    }
    
    res.json({
      interview: interviewResult.rows[0],
      behavioral_data: behavioralResult.rows[0],
      question_scores: scoresResult.rows
    });
  } catch (error) {
    console.error('Erro ao buscar analytics:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// DELETE /api/interviews/:id - Deletar entrevista
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verificar se a entrevista existe
    const checkQuery = `SELECT id FROM interviews WHERE id = $1`;
    const checkResult = await pool.query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Entrevista não encontrada' });
    }
    
    // Deletar em cascata (dados faciais, respostas, entrevista)
    await pool.query('DELETE FROM facial_analysis_data WHERE interview_id = $1', [id]);
    await pool.query('DELETE FROM interview_responses WHERE interview_id = $1', [id]);
    await pool.query('DELETE FROM interviews WHERE id = $1', [id]);
    
    res.json({ message: 'Entrevista deletada com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar entrevista:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Função para processar resposta em background (simular IA)
async function processResponseInBackground(response) {
  try {
    // Simular delay de processamento
    setTimeout(async () => {
      try {
        // Simular análise com IA (ChatGPT)
        const analysis = await simulateAIAnalysis(response);
        
        // Atualizar resposta com análise
        await pool.query(`
          UPDATE interview_responses 
          SET 
            analysis_score = $1,
            strengths = $2,
            improvements = $3,
            adequacy = $4,
            processing_status = 'completed',
            processed_at = CURRENT_TIMESTAMP
          WHERE id = $5
        `, [
          analysis.score,
          analysis.strengths,
          analysis.improvements,
          analysis.adequacy,
          response.id
        ]);
        
        console.log(`✅ Resposta ${response.id} processada com sucesso`);
      } catch (error) {
        console.error(`❌ Erro ao processar resposta ${response.id}:`, error);
        
        // Marcar como falha
        await pool.query(`
          UPDATE interview_responses 
          SET processing_status = 'failed'
          WHERE id = $1
        `, [response.id]);
      }
    }, 2000); // 2 segundos de delay
  } catch (error) {
    console.error('Erro no processamento em background:', error);
  }
}

// Função para simular análise com IA
async function simulateAIAnalysis(response) {
  // Simular análise baseada no comprimento e conteúdo da transcrição
  const transcription = response.transcription || '';
  const length = transcription.length;
  
  let score = 5.0; // Score base
  
  // Ajustar score baseado no comprimento
  if (length > 200) score += 2.0;
  else if (length > 100) score += 1.0;
  else if (length < 50) score -= 1.0;
  
  // Ajustar score baseado em palavras-chave positivas
  const positiveWords = ['experiência', 'responsável', 'liderança', 'equipe', 'projeto', 'resultado'];
  const positiveCount = positiveWords.filter(word => 
    transcription.toLowerCase().includes(word)
  ).length;
  
  score += positiveCount * 0.5;
  
  // Limitar score entre 0 e 10
  score = Math.max(0, Math.min(10, score));
  
  return {
    score: parseFloat(score.toFixed(1)),
    strengths: length > 100 ? 'Resposta detalhada e bem estruturada' : 'Resposta objetiva',
    improvements: length < 100 ? 'Poderia fornecer mais detalhes e exemplos' : 'Excelente elaboração',
    adequacy: score > 7 ? 'Muito adequada à pergunta' : score > 5 ? 'Adequada' : 'Parcialmente adequada'
  };
}

module.exports = router;

