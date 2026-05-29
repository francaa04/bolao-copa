-- ============================================================
-- BOLÃO COPA 2026 — Script de criação do banco (Supabase / Postgres)
-- COMO USAR: cole este arquivo inteiro no SQL Editor do Supabase
-- e clique em "Run". Pode rodar uma vez só. Cria tudo do zero.
-- ============================================================

-- ----------- LIMPEZA (caso rode de novo) -----------
drop table if exists palpites cascade;
drop table if exists palpites_especiais cascade;
drop table if exists jogos cascade;
drop table if exists perfis cascade;
drop table if exists config cascade;

-- ============================================================
-- TABELA: perfis (1 linha por participante)
-- Liga o usuário do Supabase Auth ao nome visível + flag de moderador
-- ============================================================
create table perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  usuario text unique not null,
  moderador boolean not null default false,
  criado_em timestamptz not null default now()
);

-- ============================================================
-- TABELA: jogos (os 72 da fase de grupos)
-- "inicio" trava o palpite automaticamente. "gols_*" = resultado real.
-- ============================================================
create table jogos (
  id text primary key,
  grupo text not null,
  rodada int not null,
  mandante text not null,
  visitante text not null,
  inicio timestamptz not null,
  gols_mandante int,
  gols_visitante int
);

-- ============================================================
-- TABELA: palpites (1 por participante por jogo)
-- ============================================================
create table palpites (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  jogo_id text not null references jogos(id) on delete cascade,
  gols_mandante int not null,
  gols_visitante int not null,
  atualizado_em timestamptz not null default now(),
  unique (user_id, jogo_id)
);

-- ============================================================
-- TABELA: palpites_especiais (campeão e artilheiro, 1 por pessoa)
-- ============================================================
create table palpites_especiais (
  user_id uuid primary key references auth.users(id) on delete cascade,
  campeao text,
  artilheiro text,
  atualizado_em timestamptz not null default now()
);

-- ============================================================
-- TABELA: config (gabarito dos especiais, editável pelo moderador)
-- ============================================================
create table config (
  id int primary key default 1,
  campeao_real text,
  artilheiro_real text,
  constraint so_uma_linha check (id = 1)
);
insert into config (id) values (1);

-- ============================================================
-- SEGURANÇA (Row Level Security)
-- Regra geral: todos logados LEEM tudo (precisam ver palpites
-- revelados e ranking). Cada um só ESCREVE o que é seu.
-- Moderador pode escrever resultados e config.
-- ============================================================
alter table perfis enable row level security;
alter table jogos enable row level security;
alter table palpites enable row level security;
alter table palpites_especiais enable row level security;
alter table config enable row level security;

-- função auxiliar: o usuário atual é moderador?
create or replace function eh_moderador()
returns boolean language sql security definer stable as $$
  select coalesce((select moderador from perfis where id = auth.uid()), false);
$$;

-- PERFIS: todos leem; cada um insere/edita o seu
create policy "perfis_leitura" on perfis for select to authenticated using (true);
create policy "perfis_insere_proprio" on perfis for insert to authenticated with check (id = auth.uid());
create policy "perfis_edita_proprio" on perfis for update to authenticated using (id = auth.uid());

-- JOGOS: todos leem; só moderador edita (lançar resultado)
create policy "jogos_leitura" on jogos for select to authenticated using (true);
create policy "jogos_moderador_edita" on jogos for update to authenticated using (eh_moderador());

-- PALPITES: todos leem (front esconde os de jogos abertos);
-- cada um escreve o seu, e SÓ enquanto o jogo não começou.
create policy "palpites_leitura" on palpites for select to authenticated using (true);
create policy "palpites_insere" on palpites for insert to authenticated
  with check (
    user_id = auth.uid()
    and (select inicio from jogos where id = jogo_id) > now()
  );
create policy "palpites_edita" on palpites for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (select inicio from jogos where id = jogo_id) > now()
  );

-- ESPECIAIS: todos leem (sempre visíveis); cada um escreve o seu
create policy "esp_leitura" on palpites_especiais for select to authenticated using (true);
create policy "esp_insere" on palpites_especiais for insert to authenticated with check (user_id = auth.uid());
create policy "esp_edita" on palpites_especiais for update to authenticated using (user_id = auth.uid());

-- CONFIG: todos leem; só moderador edita
create policy "config_leitura" on config for select to authenticated using (true);
create policy "config_moderador" on config for update to authenticated using (eh_moderador());

-- ============================================================
-- VIEW: classificacao — calcula pontos no banco (fonte da verdade)
-- 15 = placar exato | 5 = acertou resultado | 0 = errou
-- +50 campeão | +50 artilheiro
-- ============================================================
create or replace view classificacao as
with pontos_jogos as (
  select
    p.user_id,
    case
      when j.gols_mandante is null or j.gols_visitante is null then 0
      when p.gols_mandante = j.gols_mandante and p.gols_visitante = j.gols_visitante then 15
      when sign(p.gols_mandante - p.gols_visitante) = sign(j.gols_mandante - j.gols_visitante) then 5
      else 0
    end as pts,
    case
      when j.gols_mandante is not null
       and p.gols_mandante = j.gols_mandante
       and p.gols_visitante = j.gols_visitante then 1 else 0
    end as exato
  from palpites p
  join jogos j on j.id = p.jogo_id
),
agg as (
  select user_id, sum(pts) as pts_jogos, sum(exato) as exatos
  from pontos_jogos group by user_id
)
select
  perf.id as user_id,
  perf.usuario,
  coalesce(a.pts_jogos, 0)
    + case when e.campeao is not null and e.campeao = c.campeao_real then 50 else 0 end
    + case when e.artilheiro is not null and e.artilheiro = c.artilheiro_real then 50 else 0 end
    as total,
  coalesce(a.exatos, 0) as exatos,
  (e.artilheiro is not null and e.artilheiro = c.artilheiro_real) as acertou_artilheiro,
  (e.campeao is not null and e.campeao = c.campeao_real) as acertou_campeao
from perfis perf
left join agg a on a.user_id = perf.id
left join palpites_especiais e on e.user_id = perf.id
cross join config c
order by total desc,
         acertou_artilheiro desc,
         acertou_campeao desc,
         exatos desc;

grant select on classificacao to authenticated;

-- ============================================================
-- OS 72 JOGOS DA FASE DE GRUPOS (horários de Brasília, UTC-3)
-- ============================================================
insert into jogos (id, grupo, rodada, mandante, visitante, inicio) values
('G01','A',1,'México','África do Sul','2026-06-11T16:00:00-03:00'),
('G02','A',1,'Coreia do Sul','Chéquia','2026-06-11T23:00:00-03:00'),
('G03','B',1,'Canadá','Bósnia e Herzegovina','2026-06-12T16:00:00-03:00'),
('G04','D',1,'Estados Unidos','Paraguai','2026-06-12T22:00:00-03:00'),
('G05','D',1,'Austrália','Turquia','2026-06-13T01:00:00-03:00'),
('G06','B',1,'Catar','Suíça','2026-06-13T16:00:00-03:00'),
('G07','C',1,'Brasil','Marrocos','2026-06-13T19:00:00-03:00'),
('G08','C',1,'Haiti','Escócia','2026-06-13T22:00:00-03:00'),
('G09','E',1,'Alemanha','Curaçao','2026-06-14T14:00:00-03:00'),
('G10','F',1,'Holanda','Japão','2026-06-14T17:00:00-03:00'),
('G11','E',1,'Costa do Marfim','Equador','2026-06-14T20:00:00-03:00'),
('G12','F',1,'Suécia','Tunísia','2026-06-14T23:00:00-03:00'),
('G13','H',1,'Espanha','Cabo Verde','2026-06-15T13:00:00-03:00'),
('G14','G',1,'Bélgica','Egito','2026-06-15T16:00:00-03:00'),
('G15','H',1,'Arábia Saudita','Uruguai','2026-06-15T19:00:00-03:00'),
('G16','G',1,'Irã','Nova Zelândia','2026-06-15T22:00:00-03:00'),
('G17','J',1,'Argentina','Argélia','2026-06-16T14:00:00-03:00'),
('G18','I',1,'França','Senegal','2026-06-16T16:00:00-03:00'),
('G19','I',1,'Iraque','Noruega','2026-06-16T19:00:00-03:00'),
('G20','J',1,'Áustria','Jordânia','2026-06-17T01:00:00-03:00'),
('G21','K',1,'Portugal','RD Congo','2026-06-17T14:00:00-03:00'),
('G22','L',1,'Inglaterra','Croácia','2026-06-17T17:00:00-03:00'),
('G23','L',1,'Gana','Panamá','2026-06-17T20:00:00-03:00'),
('G24','K',1,'Uzbequistão','Colômbia','2026-06-17T23:00:00-03:00'),
('G25','A',2,'Chéquia','África do Sul','2026-06-18T13:00:00-03:00'),
('G26','B',2,'Suíça','Bósnia e Herzegovina','2026-06-18T16:00:00-03:00'),
('G27','B',2,'Canadá','Catar','2026-06-18T19:00:00-03:00'),
('G28','A',2,'México','Coreia do Sul','2026-06-18T22:00:00-03:00'),
('G29','D',2,'Turquia','Paraguai','2026-06-19T01:00:00-03:00'),
('G30','D',2,'Estados Unidos','Austrália','2026-06-19T16:00:00-03:00'),
('G31','C',2,'Escócia','Marrocos','2026-06-19T19:00:00-03:00'),
('G32','C',2,'Brasil','Haiti','2026-06-19T22:00:00-03:00'),
('G33','F',2,'Holanda','Suécia','2026-06-20T14:00:00-03:00'),
('G34','E',2,'Alemanha','Costa do Marfim','2026-06-20T17:00:00-03:00'),
('G35','E',2,'Equador','Curaçao','2026-06-20T21:00:00-03:00'),
('G36','F',2,'Tunísia','Japão','2026-06-21T01:00:00-03:00'),
('G37','H',2,'Espanha','Arábia Saudita','2026-06-21T13:00:00-03:00'),
('G38','G',2,'Bélgica','Irã','2026-06-21T16:00:00-03:00'),
('G39','H',2,'Uruguai','Cabo Verde','2026-06-21T19:00:00-03:00'),
('G40','G',2,'Nova Zelândia','Egito','2026-06-21T22:00:00-03:00'),
('G41','J',2,'Argentina','Áustria','2026-06-22T14:00:00-03:00'),
('G42','I',2,'França','Iraque','2026-06-22T18:00:00-03:00'),
('G43','I',2,'Noruega','Senegal','2026-06-22T21:00:00-03:00'),
('G44','J',2,'Jordânia','Argélia','2026-06-23T00:00:00-03:00'),
('G45','K',2,'Portugal','Uzbequistão','2026-06-23T14:00:00-03:00'),
('G46','L',2,'Inglaterra','Gana','2026-06-23T17:00:00-03:00'),
('G47','L',2,'Panamá','Croácia','2026-06-23T20:00:00-03:00'),
('G48','K',2,'Colômbia','RD Congo','2026-06-23T23:00:00-03:00'),
('G49','B',3,'Suíça','Canadá','2026-06-24T16:00:00-03:00'),
('G50','B',3,'Bósnia e Herzegovina','Catar','2026-06-24T16:00:00-03:00'),
('G51','C',3,'Escócia','Brasil','2026-06-24T19:00:00-03:00'),
('G52','C',3,'Marrocos','Haiti','2026-06-24T19:00:00-03:00'),
('G53','A',3,'Chéquia','México','2026-06-24T22:00:00-03:00'),
('G54','A',3,'África do Sul','Coreia do Sul','2026-06-24T22:00:00-03:00'),
('G55','E',3,'Equador','Alemanha','2026-06-25T17:00:00-03:00'),
('G56','E',3,'Curaçao','Costa do Marfim','2026-06-25T17:00:00-03:00'),
('G57','F',3,'Japão','Suécia','2026-06-25T20:00:00-03:00'),
('G58','F',3,'Tunísia','Holanda','2026-06-25T20:00:00-03:00'),
('G59','D',3,'Turquia','Estados Unidos','2026-06-25T23:00:00-03:00'),
('G60','D',3,'Paraguai','Austrália','2026-06-25T23:00:00-03:00'),
('G61','I',3,'Noruega','França','2026-06-26T16:00:00-03:00'),
('G62','I',3,'Senegal','Iraque','2026-06-26T16:00:00-03:00'),
('G63','H',3,'Cabo Verde','Arábia Saudita','2026-06-26T21:00:00-03:00'),
('G64','H',3,'Uruguai','Espanha','2026-06-26T21:00:00-03:00'),
('G65','G',3,'Egito','Irã','2026-06-27T00:00:00-03:00'),
('G66','G',3,'Nova Zelândia','Bélgica','2026-06-27T00:00:00-03:00'),
('G67','L',3,'Panamá','Inglaterra','2026-06-27T18:00:00-03:00'),
('G68','L',3,'Croácia','Gana','2026-06-27T18:00:00-03:00'),
('G69','K',3,'Colômbia','Portugal','2026-06-27T20:30:00-03:00'),
('G70','K',3,'RD Congo','Uzbequistão','2026-06-27T20:30:00-03:00'),
('G71','J',3,'Argélia','Áustria','2026-06-27T23:00:00-03:00'),
('G72','J',3,'Jordânia','Argentina','2026-06-27T23:00:00-03:00');

-- FIM. Banco pronto.
