-- Script completo de atualização do banco de dados
-- Adiciona todas as funcionalidades das Fases 2-4 do roadmap

-- 1. Adicionar campo created_via_ai na tabela jobs (se não existir)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS created_via_ai BOOLEAN DEFAULT false;

-- 2. Tabela de perguntas customizadas por vaga
CREATE TABLE IF NOT EXISTS job_interview_questions (
    id SERIAL PRIMARY KEY,
    job_id INTEGER REFERENCES jobs(id),
    question_number INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    is_default BOOLEAN DEFAULT false,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabelas do Sistema de Entrevistas
CREATE TABLE IF NOT EXISTS interviews (
    id SERIAL PRIMARY KEY,
    job_id INTEGER REFERENCES jobs(id),
    candidate_name VARCHAR(255),
    candidate_email VARCHAR(255),
    status VARCHAR(50) DEFAULT 'in_progress', -- in_progress, completed, cancelled
    total_questions INTEGER DEFAULT 0,
    answered_questions INTEGER DEFAULT 0,
    overall_score DECIMAL(3,1), -- 0.0 to 10.0
    facial_data_points INTEGER DEFAULT 0,
    video_url VARCHAR(500),
    final_report TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    created_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS interview_responses (
    id SERIAL PRIMARY KEY,
    interview_id INTEGER REFERENCES interviews(id),
    question_number INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    transcription TEXT,
    video_blob_url VARCHAR(500),
    analysis_score DECIMAL(3,1), -- 0.0 to 10.0
    strengths TEXT,
    improvements TEXT,
    adequacy TEXT,
    facial_data JSONB, -- dados da Face API
    processing_status VARCHAR(50) DEFAULT 'pending', -- pending, processing, completed, failed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS facial_analysis_data (
    id SERIAL PRIMARY KEY,
    interview_id INTEGER REFERENCES interviews(id),
    response_id INTEGER REFERENCES interview_responses(id),
    timestamp_ms INTEGER, -- timestamp no vídeo
    confidence DECIMAL(5,2), -- 0.00 to 100.00
    emotions JSONB, -- {happy: 0.8, sad: 0.1, etc}
    head_pose JSONB, -- {pitch, yaw, roll}
    eye_gaze JSONB, -- direção do olhar
    facial_landmarks JSONB, -- pontos faciais
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tabelas do Sistema de Testes Psicológicos
CREATE TABLE IF NOT EXISTS psychological_tests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    test_type VARCHAR(50) DEFAULT 'unified', -- unified, disc_only, big_five_only, leadership_only
    status VARCHAR(50) DEFAULT 'in_progress', -- in_progress, completed, cancelled
    total_questions INTEGER DEFAULT 25,
    answered_questions INTEGER DEFAULT 0,
    disc_scores JSONB, -- {D: 8.5, I: 6.2, S: 7.1, C: 9.0}
    big_five_scores JSONB, -- {openness: 7.5, conscientiousness: 8.0, etc}
    leadership_scores JSONB, -- {autocratic: 3.2, democratic: 8.1, etc}
    overall_analysis TEXT,
    recommendations TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS test_questions (
    id SERIAL PRIMARY KEY,
    question_number INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    question_type VARCHAR(50) NOT NULL, -- disc, big_five, leadership
    dimension VARCHAR(50), -- D/I/S/C, openness/conscientiousness/etc, autocratic/democratic/etc
    options JSONB NOT NULL, -- ["Opção A", "Opção B", "Opção C", "Opção D"]
    scoring_weights JSONB, -- {A: {D: 3, I: 1}, B: {D: 1, I: 3}, etc}
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS test_responses (
    id SERIAL PRIMARY KEY,
    test_id INTEGER REFERENCES psychological_tests(id),
    question_id INTEGER REFERENCES test_questions(id),
    question_number INTEGER NOT NULL,
    selected_option VARCHAR(10) NOT NULL, -- A, B, C, D ou 1, 2, 3, 4
    response_value INTEGER, -- valor numérico da resposta (1-4)
    dimension_scores JSONB, -- scores calculados para cada dimensão
    answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS personality_profiles (
    id SERIAL PRIMARY KEY,
    test_id INTEGER REFERENCES psychological_tests(id),
    profile_type VARCHAR(50) NOT NULL, -- disc, big_five, leadership
    primary_trait VARCHAR(100),
    secondary_trait VARCHAR(100),
    description TEXT,
    strengths TEXT,
    development_areas TEXT,
    career_suggestions TEXT,
    compatibility JSONB, -- compatibilidade com outros perfis
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Índices para performance
CREATE INDEX IF NOT EXISTS idx_job_interview_questions_job_id ON job_interview_questions(job_id);
CREATE INDEX IF NOT EXISTS idx_interviews_job_id ON interviews(job_id);
CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews(status);
CREATE INDEX IF NOT EXISTS idx_interview_responses_interview_id ON interview_responses(interview_id);
CREATE INDEX IF NOT EXISTS idx_interview_responses_processing_status ON interview_responses(processing_status);
CREATE INDEX IF NOT EXISTS idx_facial_analysis_interview_id ON facial_analysis_data(interview_id);
CREATE INDEX IF NOT EXISTS idx_psychological_tests_user_id ON psychological_tests(user_id);
CREATE INDEX IF NOT EXISTS idx_psychological_tests_status ON psychological_tests(status);
CREATE INDEX IF NOT EXISTS idx_test_questions_type ON test_questions(question_type);
CREATE INDEX IF NOT EXISTS idx_test_questions_number ON test_questions(question_number);
CREATE INDEX IF NOT EXISTS idx_test_responses_test_id ON test_responses(test_id);
CREATE INDEX IF NOT EXISTS idx_personality_profiles_test_id ON personality_profiles(test_id);

-- 6. Inserir perguntas padrão para entrevistas
INSERT INTO job_interview_questions (job_id, question_number, question_text, is_default) VALUES
(NULL, 1, 'Conte-me sobre sua trajetória profissional e o que o motivou a se candidatar para esta vaga.', true),
(NULL, 2, 'Quais são seus principais pontos fortes e como eles se aplicam a esta posição?', true),
(NULL, 3, 'Descreva uma situação desafiadora que você enfrentou no trabalho e como a resolveu.', true),
(NULL, 4, 'Onde você se vê profissionalmente em 5 anos e como esta vaga se encaixa em seus planos?', true),
(NULL, 5, 'Você tem alguma pergunta sobre a empresa, a vaga ou nossa cultura organizacional?', true)
ON CONFLICT DO NOTHING;

-- 7. Inserir perguntas do teste psicológico unificado (apenas se não existirem)
INSERT INTO test_questions (question_number, question_text, question_type, dimension, options, scoring_weights) VALUES
-- DISC (10 perguntas)
(1, 'Em situações de trabalho, eu prefiro:', 'disc', 'mixed', 
 '["Tomar decisões rapidamente e assumir o controle", "Trabalhar com pessoas e motivar a equipe", "Manter a estabilidade e apoiar os colegas", "Analisar dados e seguir procedimentos"]',
 '{"A": {"D": 3, "I": 0, "S": 0, "C": 1}, "B": {"D": 1, "I": 3, "S": 1, "C": 0}, "C": {"D": 0, "I": 1, "S": 3, "C": 1}, "D": {"D": 0, "I": 0, "S": 1, "C": 3}}'),

(2, 'Quando enfrento um problema difícil, eu:', 'disc', 'mixed',
 '["Ajo imediatamente para resolver", "Busco ajuda e opiniões de outros", "Penso cuidadosamente antes de agir", "Pesquiso e analiso todas as opções"]',
 '{"A": {"D": 3, "I": 0, "S": 0, "C": 1}, "B": {"D": 1, "I": 3, "S": 1, "C": 0}, "C": {"D": 0, "I": 1, "S": 3, "C": 1}, "D": {"D": 0, "I": 0, "S": 1, "C": 3}}'),

(3, 'Em reuniões, eu geralmente:', 'disc', 'mixed',
 '["Lidero a discussão e tomo decisões", "Animo o grupo e gero ideias", "Escuto e apoio as decisões do grupo", "Faço perguntas detalhadas e analiso propostas"]',
 '{"A": {"D": 3, "I": 0, "S": 0, "C": 1}, "B": {"D": 1, "I": 3, "S": 1, "C": 0}, "C": {"D": 0, "I": 1, "S": 3, "C": 1}, "D": {"D": 0, "I": 0, "S": 1, "C": 3}}'),

(4, 'Meu estilo de comunicação é:', 'disc', 'mixed',
 '["Direto e objetivo", "Entusiástico e expressivo", "Calmo e paciente", "Preciso e detalhado"]',
 '{"A": {"D": 3, "I": 0, "S": 0, "C": 1}, "B": {"D": 1, "I": 3, "S": 1, "C": 0}, "C": {"D": 0, "I": 1, "S": 3, "C": 1}, "D": {"D": 0, "I": 0, "S": 1, "C": 3}}'),

(5, 'Quando trabalho em equipe, eu:', 'disc', 'mixed',
 '["Assumo a liderança naturalmente", "Motivo e energizo os colegas", "Colaboro e mantenho a harmonia", "Organizo e estruturo o trabalho"]',
 '{"A": {"D": 3, "I": 0, "S": 0, "C": 1}, "B": {"D": 1, "I": 3, "S": 1, "C": 0}, "C": {"D": 0, "I": 1, "S": 3, "C": 1}, "D": {"D": 0, "I": 0, "S": 1, "C": 3}}'),

(6, 'Sob pressão, eu tendo a:', 'disc', 'mixed',
 '["Ficar mais determinado e focado", "Buscar apoio e conversar sobre o problema", "Manter a calma e ser paciente", "Ser mais cauteloso e analítico"]',
 '{"A": {"D": 3, "I": 0, "S": 0, "C": 1}, "B": {"D": 1, "I": 3, "S": 1, "C": 0}, "C": {"D": 0, "I": 1, "S": 3, "C": 1}, "D": {"D": 0, "I": 0, "S": 1, "C": 3}}'),

(7, 'Minha abordagem para mudanças é:', 'disc', 'mixed',
 '["Abraço mudanças rapidamente", "Vejo mudanças como oportunidades emocionantes", "Prefiro mudanças graduais e planejadas", "Analiso cuidadosamente antes de aceitar mudanças"]',
 '{"A": {"D": 3, "I": 0, "S": 0, "C": 1}, "B": {"D": 1, "I": 3, "S": 1, "C": 0}, "C": {"D": 0, "I": 1, "S": 3, "C": 1}, "D": {"D": 0, "I": 0, "S": 1, "C": 3}}'),

(8, 'Quando tomo decisões, eu:', 'disc', 'mixed',
 '["Decido rapidamente baseado na intuição", "Consulto outros e considero o impacto nas pessoas", "Tomo tempo para considerar todas as implicações", "Analiso dados e fatos cuidadosamente"]',
 '{"A": {"D": 3, "I": 0, "S": 0, "C": 1}, "B": {"D": 1, "I": 3, "S": 1, "C": 0}, "C": {"D": 0, "I": 1, "S": 3, "C": 1}, "D": {"D": 0, "I": 0, "S": 1, "C": 3}}'),

(9, 'Em conflitos, eu prefiro:', 'disc', 'mixed',
 '["Confrontar diretamente o problema", "Mediar e encontrar soluções que agradem a todos", "Evitar conflitos e manter a paz", "Analisar objetivamente e encontrar soluções lógicas"]',
 '{"A": {"D": 3, "I": 0, "S": 0, "C": 1}, "B": {"D": 1, "I": 3, "S": 1, "C": 0}, "C": {"D": 0, "I": 1, "S": 3, "C": 1}, "D": {"D": 0, "I": 0, "S": 1, "C": 3}}'),

(10, 'Meu ritmo de trabalho é:', 'disc', 'mixed',
 '["Rápido e intenso", "Variável, dependendo do meu humor", "Constante e estável", "Metódico e cuidadoso"]',
 '{"A": {"D": 3, "I": 0, "S": 0, "C": 1}, "B": {"D": 1, "I": 3, "S": 1, "C": 0}, "C": {"D": 0, "I": 1, "S": 3, "C": 1}, "D": {"D": 0, "I": 0, "S": 1, "C": 3}}'),

-- Big Five (10 perguntas)
(11, 'Eu me considero uma pessoa que gosta de experimentar coisas novas:', 'big_five', 'openness',
 '["Discordo totalmente", "Discordo parcialmente", "Concordo parcialmente", "Concordo totalmente"]',
 '{"A": {"openness": 1}, "B": {"openness": 2}, "C": {"openness": 3}, "D": {"openness": 4}}'),

(12, 'Eu tenho uma imaginação muito ativa:', 'big_five', 'openness',
 '["Discordo totalmente", "Discordo parcialmente", "Concordo parcialmente", "Concordo totalmente"]',
 '{"A": {"openness": 1}, "B": {"openness": 2}, "C": {"openness": 3}, "D": {"openness": 4}}'),

(13, 'Eu sou uma pessoa muito organizada:', 'big_five', 'conscientiousness',
 '["Discordo totalmente", "Discordo parcialmente", "Concordo parcialmente", "Concordo totalmente"]',
 '{"A": {"conscientiousness": 1}, "B": {"conscientiousness": 2}, "C": {"conscientiousness": 3}, "D": {"conscientiousness": 4}}'),

(14, 'Eu sempre cumpro meus compromissos:', 'big_five', 'conscientiousness',
 '["Discordo totalmente", "Discordo parcialmente", "Concordo parcialmente", "Concordo totalmente"]',
 '{"A": {"conscientiousness": 1}, "B": {"conscientiousness": 2}, "C": {"conscientiousness": 3}, "D": {"conscientiousness": 4}}'),

(15, 'Eu me sinto energizado quando estou com outras pessoas:', 'big_five', 'extraversion',
 '["Discordo totalmente", "Discordo parcialmente", "Concordo parcialmente", "Concordo totalmente"]',
 '{"A": {"extraversion": 1}, "B": {"extraversion": 2}, "C": {"extraversion": 3}, "D": {"extraversion": 4}}'),

(16, 'Eu gosto de ser o centro das atenções:', 'big_five', 'extraversion',
 '["Discordo totalmente", "Discordo parcialmente", "Concordo parcialmente", "Concordo totalmente"]',
 '{"A": {"extraversion": 1}, "B": {"extraversion": 2}, "C": {"extraversion": 3}, "D": {"extraversion": 4}}'),

(17, 'Eu me preocupo com os sentimentos dos outros:', 'big_five', 'agreeableness',
 '["Discordo totalmente", "Discordo parcialmente", "Concordo parcialmente", "Concordo totalmente"]',
 '{"A": {"agreeableness": 1}, "B": {"agreeableness": 2}, "C": {"agreeableness": 3}, "D": {"agreeableness": 4}}'),

(18, 'Eu confio facilmente nas pessoas:', 'big_five', 'agreeableness',
 '["Discordo totalmente", "Discordo parcialmente", "Concordo parcialmente", "Concordo totalmente"]',
 '{"A": {"agreeableness": 1}, "B": {"agreeableness": 2}, "C": {"agreeableness": 3}, "D": {"agreeableness": 4}}'),

(19, 'Eu me sinto ansioso com frequência:', 'big_five', 'neuroticism',
 '["Discordo totalmente", "Discordo parcialmente", "Concordo parcialmente", "Concordo totalmente"]',
 '{"A": {"neuroticism": 1}, "B": {"neuroticism": 2}, "C": {"neuroticism": 3}, "D": {"neuroticism": 4}}'),

(20, 'Eu me recupero rapidamente de situações estressantes:', 'big_five', 'neuroticism',
 '["Discordo totalmente", "Discordo parcialmente", "Concordo parcialmente", "Concordo totalmente"]',
 '{"A": {"neuroticism": 4}, "B": {"neuroticism": 3}, "C": {"neuroticism": 2}, "D": {"neuroticism": 1}}'),

-- Liderança (5 perguntas)
(21, 'Como líder, eu prefiro:', 'leadership', 'style',
 '["Tomar decisões sozinho e comunicar à equipe", "Consultar a equipe mas decidir sozinho", "Decidir em conjunto com a equipe", "Deixar a equipe decidir com minha orientação"]',
 '{"A": {"autocratic": 4, "democratic": 1}, "B": {"autocratic": 3, "democratic": 2}, "C": {"autocratic": 2, "democratic": 3}, "D": {"autocratic": 1, "democratic": 4}}'),

(22, 'Quando minha equipe enfrenta um desafio, eu:', 'leadership', 'approach',
 '["Dou instruções claras sobre o que fazer", "Explico o problema e peço sugestões", "Facilito uma discussão em grupo", "Apoio a equipe a encontrar suas próprias soluções"]',
 '{"A": {"autocratic": 4, "democratic": 1}, "B": {"autocratic": 3, "democratic": 2}, "C": {"autocratic": 2, "democratic": 3}, "D": {"autocratic": 1, "democratic": 4}}'),

(23, 'Minha principal motivação como líder é:', 'leadership', 'motivation',
 '["Alcançar resultados e metas", "Desenvolver e inspirar pessoas", "Criar um ambiente colaborativo", "Servir e apoiar minha equipe"]',
 '{"A": {"transactional": 4, "transformational": 1}, "B": {"transactional": 1, "transformational": 4}, "C": {"transactional": 2, "transformational": 3}, "D": {"transactional": 1, "transformational": 2, "servant": 4}}'),

(24, 'Quando reconheço o trabalho da equipe, eu:', 'leadership', 'recognition',
 '["Foco nos resultados alcançados", "Celebro o crescimento e aprendizado", "Reconheço o esforço colaborativo", "Destaco como cada pessoa contribuiu"]',
 '{"A": {"transactional": 4, "transformational": 1}, "B": {"transactional": 1, "transformational": 4}, "C": {"transactional": 2, "transformational": 3}, "D": {"transactional": 1, "transformational": 2, "servant": 4}}'),

(25, 'Minha visão de liderança ideal é:', 'leadership', 'vision',
 '["Liderar pelo exemplo e autoridade", "Inspirar e transformar pessoas", "Facilitar e empoderar a equipe", "Servir e desenvolver cada membro"]',
 '{"A": {"autocratic": 3, "transactional": 3}, "B": {"transformational": 4}, "C": {"democratic": 4}, "D": {"servant": 4}}')
ON CONFLICT (question_number) DO NOTHING;

-- Mensagem de conclusão
SELECT 'Banco de dados atualizado com sucesso! Todas as funcionalidades das Fases 2-4 foram implementadas.' as status;

