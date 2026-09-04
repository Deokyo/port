-- 0013 Piloto sem CRM: os dados entram por planilha Excel e a conferencia e manual.
--
-- Decisao do responsavel em 2026-09-03 (D-28): no primeiro momento o Ploomes NAO sera usado.
-- O objetivo e testar a aderencia do programa antes de escalar.
--
-- Consequencia direta: a constraint criada na 0011 exigia ploomes_id para marcar uma
-- oportunidade como elegivel. Mantida como estava, ela tornaria IMPOSSIVEL conferir qualquer
-- linha no piloto — nenhuma oportunidade sairia de 'pending_validation'.
--
-- O que NAO muda: elegivel continua exigindo validador identificado e momento da validacao.
-- A rastreabilidade da conferencia manual e o que sustenta a apuracao (politica, secao 6).
-- Quando o Ploomes entrar, o registro volta a ser exigido por regra de negocio, nao por schema.

alter table referral drop constraint referral_eligibility_requires_validation;

alter table referral add constraint referral_eligibility_requires_validation check (
  eligibility_status <> 'eligible'
  or (validated_by is not null and validated_at is not null)
);

comment on column referral.ploomes_id is
  'Registro no CRM. Opcional no piloto (D-28): sem Ploomes a titularidade e resolvida por '
  'empresa cliente normalizada + servico, com prioridade de quem registrou primeiro.';
