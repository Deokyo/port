import type { Queryable } from "../db/client";
import { pendingRule } from "../lib/errors";
import { RULE_SEEDS } from "./rule-registry";

export interface ActiveRule {
  ruleKey: string;
  version: number;
  definition: Record<string, unknown>;
  approverName: string;
  approvedAt: string;
}

/** Retorna a versao APROVADA e vigente da regra, ou null. Nunca retorna proposed/pending. */
export async function findActiveRule(t: Queryable, ruleKey: string): Promise<ActiveRule | null> {
  const rows = await t.query<{
    rule_key: string; version: number; definition: Record<string, unknown>;
    approver_name: string; approved_at: string;
  }>(
    `select rule_key, version, definition, approver_name, approved_at
       from business_rule
      where rule_key = $1
        and status = 'approved'
        and effective_from <= now()
        and (effective_to is null or effective_to > now())
      order by version desc
      limit 1`,
    [ruleKey],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ruleKey: row.rule_key,
    version: row.version,
    definition: row.definition ?? {},
    approverName: row.approver_name,
    approvedAt: row.approved_at,
  };
}

export async function requireActiveRule(t: Queryable, ruleKey: string): Promise<ActiveRule> {
  const rule = await findActiveRule(t, ruleKey);
  if (!rule) throw pendingRule(ruleKey);
  return rule;
}

/** Status declarado de cada regra, para exibicao honesta na interface. */
export async function ruleStatusReport(t: Queryable) {
  const rows = await t.query<{
    rule_key: string; version: number; name: string; status: string;
    statement: string; approver_name: string | null; approved_at: string | null;
  }>(
    `select distinct on (rule_key)
            rule_key, version, name, status, statement, approver_name, approved_at
       from business_rule order by rule_key, version desc`,
  );
  const decisionByKey = new Map(RULE_SEEDS.map((r) => [r.key, r.decisionId]));
  return rows.map((r) => ({
    ruleKey: r.rule_key,
    version: r.version,
    name: r.name,
    status: r.status,
    statement: r.statement,
    approverName: r.approver_name,
    approvedAt: r.approved_at,
    decisionId: decisionByKey.get(r.rule_key) ?? null,
  }));
}
