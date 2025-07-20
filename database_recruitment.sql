-- Tabela de vagas
CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    company VARCHAR(255) NOT NULL,
    location VARCHAR(255),
    job_type VARCHAR(50) DEFAULT 'full-time', -- full-time, part-time, contract, internship
    experience_level VARCHAR(50), -- entry, mid, senior, executive
    salary_range VARCHAR(100),
    description TEXT,
    requirements TEXT,
    benefits TEXT,
    skills_required JSONB,
    status VARCHAR(20) DEFAULT 'active', -- active, paused, closed
    applications_count INTEGER DEFAULT 0,
    views_count INTEGER DEFAULT 0,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de buscas no LinkedIn
CREATE TABLE IF NOT EXISTS linkedin_searches (
    id SERIAL PRIMARY KEY,
    job_id INTEGER REFERENCES jobs(id),
    keywords VARCHAR(500),
    location VARCHAR(255),
    experience_level VARCHAR(50),
    skills JSONB,
    company_size VARCHAR(50),
    industry VARCHAR(100),
    results_count INTEGER DEFAULT 0,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de candidatos encontrados no LinkedIn
CREATE TABLE IF NOT EXISTS linkedin_candidates (
    id SERIAL PRIMARY KEY,
    search_id INTEGER REFERENCES linkedin_searches(id),
    linkedin_url VARCHAR(500),
    name VARCHAR(255),
    title VARCHAR(255),
    company VARCHAR(255),
    location VARCHAR(255),
    experience_years INTEGER,
    skills JSONB,
    summary TEXT,
    profile_image VARCHAR(500),
    contact_info JSONB,
    match_score INTEGER, -- 0-100
    status VARCHAR(20) DEFAULT 'found', -- found, contacted, responded, hired, rejected
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de contatos com candidatos
CREATE TABLE IF NOT EXISTS candidate_contacts (
    id SERIAL PRIMARY KEY,
    candidate_id INTEGER REFERENCES linkedin_candidates(id),
    job_id INTEGER REFERENCES jobs(id),
    contact_type VARCHAR(50), -- linkedin_message, inmail, email, phone
    message TEXT,
    response TEXT,
    status VARCHAR(20) DEFAULT 'sent', -- sent, delivered, read, responded
    contacted_by INTEGER REFERENCES users(id),
    contacted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMP
);

-- Tabela de aplicações para vagas
CREATE TABLE IF NOT EXISTS job_applications (
    id SERIAL PRIMARY KEY,
    job_id INTEGER REFERENCES jobs(id),
    candidate_id INTEGER REFERENCES linkedin_candidates(id),
    user_id INTEGER REFERENCES users(id), -- se for usuário da plataforma
    status VARCHAR(20) DEFAULT 'applied', -- applied, reviewing, interview, hired, rejected
    cover_letter TEXT,
    resume_url VARCHAR(500),
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_by ON jobs(created_by);
CREATE INDEX IF NOT EXISTS idx_linkedin_searches_job_id ON linkedin_searches(job_id);
CREATE INDEX IF NOT EXISTS idx_linkedin_candidates_search_id ON linkedin_candidates(search_id);
CREATE INDEX IF NOT EXISTS idx_linkedin_candidates_match_score ON linkedin_candidates(match_score);
CREATE INDEX IF NOT EXISTS idx_candidate_contacts_candidate_id ON candidate_contacts(candidate_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_job_id ON job_applications(job_id);

-- Inserir dados de exemplo
INSERT INTO jobs (title, company, location, job_type, experience_level, salary_range, description, requirements, benefits, skills_required, created_by) VALUES
('Engenheiro Agrônomo Sênior', 'Syngenta', 'São Paulo, SP', 'full-time', 'senior', 'R$ 8.000 - R$ 12.000', 
 'Responsável por desenvolvimento de produtos e suporte técnico a clientes na região Sudeste.',
 'Graduação em Agronomia, 5+ anos de experiência, conhecimento em defensivos agrícolas.',
 'Plano de saúde, vale refeição, participação nos lucros, carro da empresa.',
 '["Agronomia", "Defensivos Agrícolas", "Gestão de Produtos", "Relacionamento com Clientes"]', 1),

('Analista de Mercado Agro', 'Cargill', 'Campinas, SP', 'full-time', 'mid', 'R$ 5.000 - R$ 8.000',
 'Análise de mercado de commodities agrícolas e elaboração de relatórios estratégicos.',
 'Graduação em Economia/Administração, experiência com commodities, Excel avançado.',
 'Plano de saúde, vale alimentação, home office híbrido, seguro de vida.',
 '["Análise de Mercado", "Commodities", "Excel", "Power BI", "Economia"]', 1),

('Coordenador de Sustentabilidade', 'JBS', 'São Paulo, SP', 'full-time', 'senior', 'R$ 10.000 - R$ 15.000',
 'Coordenar projetos de sustentabilidade e compliance ambiental da empresa.',
 'Graduação em Engenharia Ambiental/Agronomia, experiência em sustentabilidade, certificações.',
 'Plano de saúde premium, participação nos lucros, carro executivo, viagens internacionais.',
 '["Sustentabilidade", "Compliance Ambiental", "Certificações", "Gestão de Projetos"]', 1),

('Especialista em Vendas Técnicas', 'Bayer', 'Ribeirão Preto, SP', 'full-time', 'mid', 'R$ 6.000 - R$ 9.000',
 'Vendas técnicas de sementes e defensivos para grandes produtores rurais.',
 'Graduação em Agronomia/Engenharia Agrícola, experiência em vendas, CNH categoria B.',
 'Comissões atrativas, carro da empresa, plano de saúde, vale combustível.',
 '["Vendas Técnicas", "Agronomia", "Relacionamento com Produtores", "Sementes"]', 1);

-- Inserir busca de exemplo
INSERT INTO linkedin_searches (job_id, keywords, location, experience_level, skills, company_size, industry, results_count, created_by) VALUES
(1, 'Engenheiro Agrônomo defensivos', 'São Paulo', 'senior', '["Agronomia", "Defensivos", "Vendas Técnicas"]', 'large', 'Agriculture', 23, 1);

-- Inserir candidatos de exemplo
INSERT INTO linkedin_candidates (search_id, linkedin_url, name, title, company, location, experience_years, skills, summary, profile_image, contact_info, match_score) VALUES
(1, 'https://linkedin.com/in/ana-silva-agro', 'Ana Silva', 'Engenheira Agrônoma', 'Corteva', 'São Paulo, SP', 8, 
 '["Agronomia", "Defensivos Agrícolas", "Vendas Técnicas", "Gestão de Território"]',
 'Engenheira Agrônoma com 8 anos de experiência em vendas técnicas e desenvolvimento de produtos para grandes culturas.',
 'https://i.pravatar.cc/150?u=ana-silva', 
 '{"email": "ana.silva@corteva.com", "phone": "+55 11 99999-1234"}', 95),

(1, 'https://linkedin.com/in/carlos-santos-agro', 'Carlos Santos', 'Gerente Técnico Regional', 'BASF', 'Campinas, SP', 12,
 '["Agronomia", "Gestão de Equipes", "Defensivos", "Desenvolvimento de Mercado"]',
 'Gerente com 12 anos de experiência liderando equipes técnicas e desenvolvendo novos mercados no agronegócio.',
 'https://i.pravatar.cc/150?u=carlos-santos',
 '{"email": "carlos.santos@basf.com", "phone": "+55 19 98888-5678"}', 92),

(1, 'https://linkedin.com/in/maria-oliveira-agro', 'Maria Oliveira', 'Consultora Técnica', 'FMC', 'Ribeirão Preto, SP', 6,
 '["Agronomia", "Consultoria Técnica", "Manejo Integrado", "Sustentabilidade"]',
 'Consultora técnica especializada em manejo integrado de pragas e doenças com foco em sustentabilidade.',
 'https://i.pravatar.cc/150?u=maria-oliveira',
 '{"email": "maria.oliveira@fmc.com", "phone": "+55 16 97777-9012"}', 88);

