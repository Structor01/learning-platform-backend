-- Tabelas para Sistema de Entrevistas

-- Tabela de entrevistas
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

-- Tabela de respostas das entrevistas
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

-- Tabela de dados comportamentais (Face API)
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

-- Tabela de perguntas customizadas por vaga
CREATE TABLE IF NOT EXISTS job_interview_questions (
    id SERIAL PRIMARY KEY,
    job_id INTEGER REFERENCES jobs(id),
    question_number INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    is_default BOOLEAN DEFAULT false,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_interviews_job_id ON interviews(job_id);
CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews(status);
CREATE INDEX IF NOT EXISTS idx_interview_responses_interview_id ON interview_responses(interview_id);
CREATE INDEX IF NOT EXISTS idx_interview_responses_processing_status ON interview_responses(processing_status);
CREATE INDEX IF NOT EXISTS idx_facial_analysis_interview_id ON facial_analysis_data(interview_id);
CREATE INDEX IF NOT EXISTS idx_job_interview_questions_job_id ON job_interview_questions(job_id);

-- Inserir perguntas padrão
INSERT INTO job_interview_questions (job_id, question_number, question_text, is_default) VALUES
(NULL, 1, 'Conte-me sobre sua trajetória profissional e o que o motivou a se candidatar para esta vaga.', true),
(NULL, 2, 'Quais são seus principais pontos fortes e como eles se aplicam a esta posição?', true),
(NULL, 3, 'Descreva uma situação desafiadora que você enfrentou no trabalho e como a resolveu.', true),
(NULL, 4, 'Onde você se vê profissionalmente em 5 anos e como esta vaga se encaixa em seus planos?', true),
(NULL, 5, 'Você tem alguma pergunta sobre a empresa, a vaga ou nossa cultura organizacional?', true);

-- Inserir dados de exemplo
INSERT INTO interviews (job_id, candidate_name, candidate_email, status, total_questions, answered_questions, overall_score, facial_data_points, created_by) VALUES
(1, 'João Silva', 'joao.silva@email.com', 'completed', 5, 5, 8.5, 127, 1),
(2, 'Maria Santos', 'maria.santos@email.com', 'in_progress', 5, 3, NULL, 89, 1);

INSERT INTO interview_responses (interview_id, question_number, question_text, transcription, analysis_score, strengths, improvements, adequacy, processing_status) VALUES
(1, 1, 'Conte-me sobre sua trajetória profissional...', 'Sou formado em Agronomia pela USP e tenho 8 anos de experiência...', 9.2, 'Experiência sólida, comunicação clara', 'Poderia detalhar mais projetos específicos', 'Muito adequada à vaga', 'completed'),
(1, 2, 'Quais são seus principais pontos fortes...', 'Meus principais pontos fortes são liderança e conhecimento técnico...', 8.8, 'Autoconhecimento, liderança', 'Exemplos mais concretos', 'Adequada', 'completed');

