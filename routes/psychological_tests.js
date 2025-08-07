const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const auth = require('../middleware/auth');

// POST /api/psychological-tests - Iniciar novo teste
router.post('/', auth, async (req, res) => {
  try {
    const { test_type = 'unified' } = req.body;
    
    const totalQuestions = test_type === 'unified' ? 25 : 
                          test_type === 'disc_only' ? 10 :
                          test_type === 'big_five_only' ? 10 : 5;
    
    const query = `
      INSERT INTO psychological_tests (
        user_id, test_type, total_questions
      )
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    
    const result = await pool.query(query, [req.user.id, test_type, totalQuestions]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao iniciar teste:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/psychological-tests - Listar testes do usuário
router.get('/', auth, async (req, res) => {
  try {
    const { status, limit = 10 } = req.query;
    
    let whereClause = 'WHERE user_id = $1';
    const params = [req.user.id];
    
    if (status) {
      whereClause += ` AND status = $${params.length + 1}`;
      params.push(status);
    }
    
    const query = `
      SELECT 
        pt.*,
        COUNT(pp.id) as profiles_count
      FROM psychological_tests pt
      LEFT JOIN personality_profiles pp ON pt.id = pp.test_id
      ${whereClause}
      GROUP BY pt.id
      ORDER BY pt.created_at DESC
      LIMIT $${params.length + 1}
    `;
    
    params.push(limit);
    const result = await pool.query(query, params);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar testes:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/psychological-tests/:id - Obter teste específico
router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Buscar teste
    const testQuery = `
      SELECT * FROM psychological_tests 
      WHERE id = $1 AND user_id = $2
    `;
    
    const testResult = await pool.query(testQuery, [id, req.user.id]);
    
    if (testResult.rows.length === 0) {
      return res.status(404).json({ error: 'Teste não encontrado' });
    }
    
    const test = testResult.rows[0];
    
    // Buscar respostas
    const responsesQuery = `
      SELECT 
        tr.*,
        tq.question_text,
        tq.question_type,
        tq.options
      FROM test_responses tr
      JOIN test_questions tq ON tr.question_id = tq.id
      WHERE tr.test_id = $1
      ORDER BY tr.question_number
    `;
    
    const responsesResult = await pool.query(responsesQuery, [id]);
    
    // Buscar perfis gerados
    const profilesQuery = `
      SELECT * FROM personality_profiles 
      WHERE test_id = $1
      ORDER BY profile_type
    `;
    
    const profilesResult = await pool.query(profilesQuery, [id]);
    
    res.json({
      test: test,
      responses: responsesResult.rows,
      profiles: profilesResult.rows
    });
  } catch (error) {
    console.error('Erro ao buscar teste:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/psychological-tests/:id/questions - Obter perguntas do teste
router.get('/:id/questions', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verificar se o teste existe e pertence ao usuário
    const testQuery = `
      SELECT test_type FROM psychological_tests 
      WHERE id = $1 AND user_id = $2
    `;
    
    const testResult = await pool.query(testQuery, [id, req.user.id]);
    
    if (testResult.rows.length === 0) {
      return res.status(404).json({ error: 'Teste não encontrado' });
    }
    
    const testType = testResult.rows[0].test_type;
    
    // Definir filtro de perguntas baseado no tipo de teste
    let whereClause = 'WHERE is_active = true';
    
    if (testType === 'disc_only') {
      whereClause += " AND question_type = 'disc'";
    } else if (testType === 'big_five_only') {
      whereClause += " AND question_type = 'big_five'";
    } else if (testType === 'leadership_only') {
      whereClause += " AND question_type = 'leadership'";
    }
    // Para 'unified', pega todas as perguntas
    
    const query = `
      SELECT 
        id,
        question_number,
        question_text,
        question_type,
        dimension,
        options
      FROM test_questions
      ${whereClause}
      ORDER BY question_number
    `;
    
    const result = await pool.query(query);
    
    res.json({
      test_id: id,
      test_type: testType,
      questions: result.rows,
      total_questions: result.rows.length
    });
  } catch (error) {
    console.error('Erro ao buscar perguntas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/psychological-tests/:id/responses - Submeter resposta
router.post('/:id/responses', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { question_id, question_number, selected_option } = req.body;
    
    // Verificar se o teste existe e está em progresso
    const testQuery = `
      SELECT * FROM psychological_tests 
      WHERE id = $1 AND user_id = $2 AND status = 'in_progress'
    `;
    
    const testResult = await pool.query(testQuery, [id, req.user.id]);
    
    if (testResult.rows.length === 0) {
      return res.status(404).json({ error: 'Teste não encontrado ou já finalizado' });
    }
    
    // Buscar pergunta para calcular scores
    const questionQuery = `
      SELECT * FROM test_questions WHERE id = $1
    `;
    
    const questionResult = await pool.query(questionQuery, [question_id]);
    
    if (questionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pergunta não encontrada' });
    }
    
    const question = questionResult.rows[0];
    const scoringWeights = question.scoring_weights;
    const dimensionScores = scoringWeights[selected_option] || {};
    
    // Converter resposta para valor numérico
    const responseValue = ['A', 'B', 'C', 'D'].indexOf(selected_option) + 1;
    
    // Verificar se já existe resposta para esta pergunta
    const existingQuery = `
      SELECT id FROM test_responses 
      WHERE test_id = $1 AND question_number = $2
    `;
    
    const existingResult = await pool.query(existingQuery, [id, question_number]);
    
    if (existingResult.rows.length > 0) {
      // Atualizar resposta existente
      const updateQuery = `
        UPDATE test_responses 
        SET 
          selected_option = $1,
          response_value = $2,
          dimension_scores = $3,
          answered_at = CURRENT_TIMESTAMP
        WHERE test_id = $4 AND question_number = $5
        RETURNING *
      `;
      
      const result = await pool.query(updateQuery, [
        selected_option, responseValue, JSON.stringify(dimensionScores), id, question_number
      ]);
      
      res.json(result.rows[0]);
    } else {
      // Inserir nova resposta
      const insertQuery = `
        INSERT INTO test_responses (
          test_id, question_id, question_number, 
          selected_option, response_value, dimension_scores
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      
      const result = await pool.query(insertQuery, [
        id, question_id, question_number, 
        selected_option, responseValue, JSON.stringify(dimensionScores)
      ]);
      
      // Atualizar contador de respostas
      await pool.query(`
        UPDATE psychological_tests 
        SET answered_questions = answered_questions + 1
        WHERE id = $1
      `, [id]);
      
      res.status(201).json(result.rows[0]);
    }
  } catch (error) {
    console.error('Erro ao submeter resposta:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/psychological-tests/:id/complete - Finalizar teste
router.post('/:id/complete', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verificar se o teste existe
    const testQuery = `
      SELECT * FROM psychological_tests 
      WHERE id = $1 AND user_id = $2 AND status = 'in_progress'
    `;
    
    const testResult = await pool.query(testQuery, [id, req.user.id]);
    
    if (testResult.rows.length === 0) {
      return res.status(404).json({ error: 'Teste não encontrado ou já finalizado' });
    }
    
    // Calcular scores finais
    const scores = await calculateFinalScores(id);
    
    // Gerar análise e recomendações
    const analysis = await generateAnalysis(scores);
    
    // Atualizar teste
    const updateQuery = `
      UPDATE psychological_tests 
      SET 
        status = 'completed',
        disc_scores = $1,
        big_five_scores = $2,
        leadership_scores = $3,
        overall_analysis = $4,
        recommendations = $5,
        completed_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING *
    `;
    
    const result = await pool.query(updateQuery, [
      JSON.stringify(scores.disc),
      JSON.stringify(scores.bigFive),
      JSON.stringify(scores.leadership),
      analysis.overall,
      analysis.recommendations,
      id
    ]);
    
    // Gerar perfis de personalidade
    await generatePersonalityProfiles(id, scores);
    
    res.json({
      test: result.rows[0],
      scores: scores,
      analysis: analysis
    });
  } catch (error) {
    console.error('Erro ao finalizar teste:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/psychological-tests/:id/report - Gerar relatório do teste
router.get('/:id/report', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Buscar teste completo
    const testQuery = `
      SELECT * FROM psychological_tests 
      WHERE id = $1 AND user_id = $2 AND status = 'completed'
    `;
    
    const testResult = await pool.query(testQuery, [id, req.user.id]);
    
    if (testResult.rows.length === 0) {
      return res.status(404).json({ error: 'Teste não encontrado ou não finalizado' });
    }
    
    const test = testResult.rows[0];
    
    // Buscar perfis
    const profilesQuery = `
      SELECT * FROM personality_profiles 
      WHERE test_id = $1
      ORDER BY profile_type
    `;
    
    const profilesResult = await pool.query(profilesQuery, [id]);
    
    // Gerar relatório detalhado
    const report = generateDetailedReport(test, profilesResult.rows);
    
    res.json(report);
  } catch (error) {
    console.error('Erro ao gerar relatório:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Função para calcular scores finais
async function calculateFinalScores(testId) {
  try {
    // Buscar todas as respostas
    const responsesQuery = `
      SELECT 
        tr.dimension_scores,
        tq.question_type
      FROM test_responses tr
      JOIN test_questions tq ON tr.question_id = tq.id
      WHERE tr.test_id = $1
    `;
    
    const result = await pool.query(responsesQuery, [testId]);
    const responses = result.rows;
    
    // Inicializar scores
    const scores = {
      disc: { D: 0, I: 0, S: 0, C: 0 },
      bigFive: { 
        openness: 0, 
        conscientiousness: 0, 
        extraversion: 0, 
        agreeableness: 0, 
        neuroticism: 0 
      },
      leadership: { 
        autocratic: 0, 
        democratic: 0, 
        transformational: 0, 
        transactional: 0, 
        servant: 0 
      }
    };
    
    // Contadores para médias
    const counts = {
      disc: { D: 0, I: 0, S: 0, C: 0 },
      bigFive: { 
        openness: 0, 
        conscientiousness: 0, 
        extraversion: 0, 
        agreeableness: 0, 
        neuroticism: 0 
      },
      leadership: { 
        autocratic: 0, 
        democratic: 0, 
        transformational: 0, 
        transactional: 0, 
        servant: 0 
      }
    };
    
    // Somar scores por dimensão
    responses.forEach(response => {
      const dimensionScores = response.dimension_scores;
      const questionType = response.question_type;
      
      Object.keys(dimensionScores).forEach(dimension => {
        const score = dimensionScores[dimension];
        
        if (questionType === 'disc' && scores.disc.hasOwnProperty(dimension)) {
          scores.disc[dimension] += score;
          counts.disc[dimension]++;
        } else if (questionType === 'big_five' && scores.bigFive.hasOwnProperty(dimension)) {
          scores.bigFive[dimension] += score;
          counts.bigFive[dimension]++;
        } else if (questionType === 'leadership' && scores.leadership.hasOwnProperty(dimension)) {
          scores.leadership[dimension] += score;
          counts.leadership[dimension]++;
        }
      });
    });
    
    // Calcular médias e normalizar para escala 0-10
    Object.keys(scores.disc).forEach(dim => {
      if (counts.disc[dim] > 0) {
        scores.disc[dim] = parseFloat((scores.disc[dim] / counts.disc[dim] * 2.5).toFixed(1)); // Normalizar para 0-10
      }
    });
    
    Object.keys(scores.bigFive).forEach(dim => {
      if (counts.bigFive[dim] > 0) {
        scores.bigFive[dim] = parseFloat((scores.bigFive[dim] / counts.bigFive[dim] * 2.5).toFixed(1)); // Normalizar para 0-10
      }
    });
    
    Object.keys(scores.leadership).forEach(dim => {
      if (counts.leadership[dim] > 0) {
        scores.leadership[dim] = parseFloat((scores.leadership[dim] / counts.leadership[dim] * 2.5).toFixed(1)); // Normalizar para 0-10
      }
    });
    
    return scores;
  } catch (error) {
    console.error('Erro ao calcular scores:', error);
    throw error;
  }
}

// Função para gerar análise
async function generateAnalysis(scores) {
  // Determinar perfil dominante DISC
  const discMax = Object.keys(scores.disc).reduce((a, b) => 
    scores.disc[a] > scores.disc[b] ? a : b
  );
  
  // Determinar traços Big Five mais altos
  const bigFiveMax = Object.keys(scores.bigFive).reduce((a, b) => 
    scores.bigFive[a] > scores.bigFive[b] ? a : b
  );
  
  // Determinar estilo de liderança dominante
  const leadershipMax = Object.keys(scores.leadership).reduce((a, b) => 
    scores.leadership[a] > scores.leadership[b] ? a : b
  );
  
  const discProfiles = {
    D: 'Dominante - Focado em resultados, direto e determinado',
    I: 'Influente - Sociável, otimista e persuasivo',
    S: 'Estável - Paciente, leal e colaborativo',
    C: 'Consciencioso - Analítico, preciso e sistemático'
  };
  
  const bigFiveTraits = {
    openness: 'Alta Abertura - Criativo e aberto a novas experiências',
    conscientiousness: 'Alta Conscienciosidade - Organizado e responsável',
    extraversion: 'Alta Extroversão - Sociável e energético',
    agreeableness: 'Alta Amabilidade - Cooperativo e confiante',
    neuroticism: 'Alto Neuroticismo - Sensível ao estresse'
  };
  
  const leadershipStyles = {
    autocratic: 'Autocrático - Toma decisões de forma independente',
    democratic: 'Democrático - Envolve a equipe nas decisões',
    transformational: 'Transformacional - Inspira e motiva a equipe',
    transactional: 'Transacional - Foca em recompensas e metas',
    servant: 'Servidor - Prioriza o desenvolvimento da equipe'
  };
  
  const overall = `Seu perfil indica características de ${discProfiles[discMax]}, ${bigFiveTraits[bigFiveMax]} e estilo de liderança ${leadershipStyles[leadershipMax]}.`;
  
  const recommendations = `Baseado no seu perfil, recomendamos focar no desenvolvimento de habilidades complementares e explorar oportunidades que aproveitem seus pontos fortes naturais.`;
  
  return { overall, recommendations };
}

// Função para gerar perfis de personalidade
async function generatePersonalityProfiles(testId, scores) {
  try {
    // Gerar perfil DISC
    const discMax = Object.keys(scores.disc).reduce((a, b) => 
      scores.disc[a] > scores.disc[b] ? a : b
    );
    
    const discSecond = Object.keys(scores.disc)
      .filter(key => key !== discMax)
      .reduce((a, b) => scores.disc[a] > scores.disc[b] ? a : b);
    
    await pool.query(`
      INSERT INTO personality_profiles (
        test_id, profile_type, primary_trait, secondary_trait,
        description, strengths, development_areas, career_suggestions
      )
      VALUES ($1, 'disc', $2, $3, $4, $5, $6, $7)
    `, [
      testId, discMax, discSecond,
      `Perfil ${discMax} com características ${discSecond}`,
      'Determinação, foco em resultados, liderança natural',
      'Desenvolver paciência e habilidades interpessoais',
      'Posições de liderança, gestão de projetos, vendas'
    ]);
    
    // Gerar perfil Big Five
    const bigFiveMax = Object.keys(scores.bigFive).reduce((a, b) => 
      scores.bigFive[a] > scores.bigFive[b] ? a : b
    );
    
    await pool.query(`
      INSERT INTO personality_profiles (
        test_id, profile_type, primary_trait, secondary_trait,
        description, strengths, development_areas, career_suggestions
      )
      VALUES ($1, 'big_five', $2, $3, $4, $5, $6, $7)
    `, [
      testId, bigFiveMax, 'Balanced',
      `Alto nível de ${bigFiveMax}`,
      'Personalidade equilibrada com destaque em uma área',
      'Explorar outras dimensões da personalidade',
      'Carreiras que aproveitem o traço dominante'
    ]);
    
    // Gerar perfil de Liderança
    const leadershipMax = Object.keys(scores.leadership).reduce((a, b) => 
      scores.leadership[a] > scores.leadership[b] ? a : b
    );
    
    await pool.query(`
      INSERT INTO personality_profiles (
        test_id, profile_type, primary_trait, secondary_trait,
        description, strengths, development_areas, career_suggestions
      )
      VALUES ($1, 'leadership', $2, $3, $4, $5, $6, $7)
    `, [
      testId, leadershipMax, 'Adaptive',
      `Estilo ${leadershipMax} de liderança`,
      'Capacidade de liderar com estilo específico',
      'Desenvolver flexibilidade em outros estilos',
      'Posições de liderança e gestão de equipes'
    ]);
  } catch (error) {
    console.error('Erro ao gerar perfis:', error);
    throw error;
  }
}

// Função para gerar relatório detalhado
function generateDetailedReport(test, profiles) {
  return {
    test_info: {
      id: test.id,
      type: test.test_type,
      completed_at: test.completed_at,
      total_questions: test.total_questions,
      answered_questions: test.answered_questions
    },
    scores: {
      disc: test.disc_scores,
      big_five: test.big_five_scores,
      leadership: test.leadership_scores
    },
    analysis: {
      overall: test.overall_analysis,
      recommendations: test.recommendations
    },
    profiles: profiles,
    summary: {
      primary_disc: Object.keys(test.disc_scores).reduce((a, b) => 
        test.disc_scores[a] > test.disc_scores[b] ? a : b
      ),
      primary_big_five: Object.keys(test.big_five_scores).reduce((a, b) => 
        test.big_five_scores[a] > test.big_five_scores[b] ? a : b
      ),
      primary_leadership: Object.keys(test.leadership_scores).reduce((a, b) => 
        test.leadership_scores[a] > test.leadership_scores[b] ? a : b
      )
    }
  };
}

module.exports = router;

