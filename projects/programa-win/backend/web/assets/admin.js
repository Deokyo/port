/* Painel administrativo — consome a MESMA API do WIN Board (ALTO-06).
   Sem localStorage (CRIT-02), sem autoria fixa (ALTO-01), sem pontos vindos da planilha (ALTO-02). */
(function () {
  "use strict";

  var state = { periodicity: "monthly", reference: null, jobId: null, canConfirm: false };
  var banner = document.getElementById("stateBanner");

  function setBanner(message, kind) {
    if (!message) { banner.hidden = true; banner.textContent = ""; return; }
    banner.hidden = false;
    banner.className = "state-banner " + (kind || "info");
    banner.textContent = message;
  }

  function text(id, value) {
    var node = document.getElementById(id);
    if (!node) return;
    node.classList.remove("skeleton");
    node.textContent = value;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(fn, wait);
    };
  }

  function cell(row, value) {
    var td = document.createElement("td");
    td.textContent = value === null || value === undefined ? "—" : String(value);
    row.appendChild(td);
    return td;
  }

  async function api(path, options) {
    var config = Object.assign({ credentials: "same-origin" }, options || {});
    config.headers = Object.assign({ accept: "application/json" }, config.headers || {});
    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, 15000);
    config.signal = controller.signal;
    var response;
    try {
      response = await fetch(path, config);
    } catch (error) {
      if (error && error.name === "AbortError") {
        var timeoutError = new Error("O servidor local demorou mais de 15 segundos para responder.");
        timeoutError.code = 504;
        throw timeoutError;
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
    var payload = null;
    if ((response.headers.get("content-type") || "").indexOf("application/json") >= 0) {
      payload = await response.json().catch(function () { return null; });
    }
    if (!response.ok) {
      var error = new Error(
        (payload && payload.error && payload.error.message) || "Falha na requisicao (" + response.status + ")"
      );
      error.code = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function handleError(error) {
    if (error.code === 401) {
      setBanner("Sua sessao expirou. Entre novamente para continuar.", "error");
    } else if (error.code === 403) {
      setBanner("Voce nao tem permissao para esta operacao.", "error");
    } else {
      setBanner(error.message, "error");
    }
  }

  /* ------------------------------- relatorios ------------------------------- */
  var STAGE_LABELS = {
    identified: "Oportunidade identificada",
    meeting_scheduled: "Reuniao agendada",
    meeting_held: "Reuniao realizada",
    proposal_sent: "Proposta enviada",
    sale_won: "Venda realizada",
    lost: "Perdida"
  };

  function delta(current, previous, suffix) {
    if (!previous) return current ? "novo" : "—";
    var change = ((current - previous) / previous) * 100;
    return (change >= 0 ? "+" : "") + change.toFixed(1) + (suffix || "%");
  }

  function renderFunnel(funnel, total) {
    var chart = document.getElementById("funnelChart");
    clear(chart);
    var order = ["identified", "meeting_scheduled", "meeting_held", "proposal_sent", "sale_won", "lost"];
    var byStage = {};
    funnel.forEach(function (row) { byStage[row.stage] = row.c; });
    order.forEach(function (stage) {
      var count = byStage[stage] || 0;
      var row = document.createElement("div");
      row.className = "funnel-row";
      var label = document.createElement("span");
      label.textContent = STAGE_LABELS[stage] || stage;
      var track = document.createElement("div");
      track.className = "funnel-bar";
      var fill = document.createElement("i");
      fill.style.width = (total ? Math.round((count / total) * 100) : 0) + "%";
      track.appendChild(fill);
      var value = document.createElement("b");
      value.textContent = String(count);
      row.appendChild(label); row.appendChild(track); row.appendChild(value);
      chart.appendChild(row);
    });
    document.getElementById("funnelTotal").textContent = total + " indicacoes no periodo";
  }

  function renderTerritories(territories) {
    var legend = document.getElementById("territoryLegend");
    clear(legend);
    territories.forEach(function (territory) {
      var item = document.createElement("div");
      var name = document.createElement("strong");
      name.textContent = territory.name;
      var detail = document.createElement("span");
      detail.textContent =
        territory.servicesWithWin + " de " + territory.servicesTotal + " servicos com venda" +
        (territory.stateRuleApproved ? "" : " · conquista aguardando regra");
      item.appendChild(name); item.appendChild(detail);
      legend.appendChild(item);
    });
  }

  function renderRanking(items, rules) {
    var list = document.getElementById("rankingList");
    clear(list);
    if (!rules.pointsApproved || !rules.rankingApproved) {
      var pending = document.createElement("li");
      pending.className = "ranking-pending";
      pending.textContent = "Ranking aguardando aprovacao da regra de ciclo e desempate.";
      list.appendChild(pending);
      return;
    }
    if (!items.length) {
      var empty = document.createElement("li");
      empty.textContent = "Nenhuma indicacao no periodo selecionado.";
      list.appendChild(empty);
      return;
    }
    items.forEach(function (participant) {
      var item = document.createElement("li");
      var position = document.createElement("span");
      position.className = "rank-number";
      position.textContent = String(participant.position).padStart(2, "0");
      var avatar = document.createElement("b");
      avatar.className = "avatar";
      avatar.textContent = participant.initials;   // BAI-01: textContent, nunca innerHTML
      var box = document.createElement("div");
      box.className = "rank-person";
      var name = document.createElement("strong");
      name.textContent = participant.displayName;
      var meta = document.createElement("small");
      meta.textContent = participant.referrals + " indicacoes";
      box.appendChild(name); box.appendChild(meta);
      var points = document.createElement("em");
      points.className = "rank-points";
      points.textContent = participant.points + " pts";
      item.appendChild(position); item.appendChild(avatar); item.appendChild(box); item.appendChild(points);
      list.appendChild(item);
    });
  }

  function renderRules(rules) {
    var list = document.getElementById("ruleList");
    clear(list);
    rules.forEach(function (rule) {
      var item = document.createElement("li");
      var badge = document.createElement("span");
      badge.className = "rule-badge " + rule.status;
      badge.textContent = rule.status;
      var box = document.createElement("div");
      var name = document.createElement("strong");
      name.textContent = rule.name + (rule.decisionId ? " (" + rule.decisionId + ")" : "");
      var statement = document.createElement("p");
      statement.textContent = rule.statement;
      box.appendChild(name); box.appendChild(statement);
      item.appendChild(badge); item.appendChild(box);
      list.appendChild(item);
    });
  }

  async function loadReport() {
    setBanner("Carregando o ciclo…", "info");
    var query = "?periodicity=" + encodeURIComponent(state.periodicity) +
      (state.reference ? "&reference=" + encodeURIComponent(state.reference) : "");
    var summary = await api("/api/v1/board/summary" + query);
    text("sidebarCycle", summary.cycle.label);
    text("kpiReferrals", summary.totals.referrals);
    text("kpiWins", summary.totals.wins);
    text("kpiPoints", summary.totals.points);
    text("kpiConversion", summary.totals.conversion.toFixed(1) + "%");
    text("kpiReferralsChange", delta(summary.totals.referrals, summary.previousTotals.referrals));
    text("kpiWinsChange", delta(summary.totals.wins, summary.previousTotals.wins));
    text("kpiConversionChange", delta(summary.totals.conversion, summary.previousTotals.conversion));
    text("kpiPointsNote", summary.rules.pointsApproved ? "regra vigente aplicada" : "regra pendente (D-03)");
    document.getElementById("periodDescription").textContent =
      summary.cycle.label + " · comparado com " + summary.previousCycle.label;
    renderFunnel(summary.funnel, summary.totals.referrals);
    renderTerritories(summary.territories);
    renderRanking(summary.ranking, summary.rules);
    setBanner(summary.rules.notice, summary.rules.notice ? "warn" : null);
  }

  async function loadRules() {
    renderRules(await api("/api/v1/admin/rules"));
  }

  async function loadHistory() {
    var jobs = await api("/api/v1/admin/imports");
    var body = document.getElementById("historyBody");
    clear(body);
    if (!jobs.length) {
      var row = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 5;
      td.textContent = "Nenhuma importacao registrada.";
      row.appendChild(td); body.appendChild(row);
    } else {
      jobs.forEach(function (job) {
        var row = document.createElement("tr");
        cell(row, job.filename);
        cell(row, job.valid_rows);
        cell(row, job.invalid_rows);
        cell(row, job.created_by_label);   // ALTO-01: autoria real da sessao
        cell(row, job.status);
        body.appendChild(row);
      });
    }

    var audit = await api("/api/v1/admin/audit?pageSize=15");
    var auditBody = document.getElementById("auditBody");
    clear(auditBody);
    audit.items.forEach(function (event) {
      var row = document.createElement("tr");
      cell(row, new Date(event.occurred_at).toLocaleString("pt-BR"));
      cell(row, event.actor_label);
      cell(row, event.action);
      cell(row, event.resource_type + (event.resource_id ? " · " + String(event.resource_id).slice(0, 8) : ""));
      cell(row, event.outcome);
      auditBody.appendChild(row);
    });
  }

  /* ------------------------------- importacao ------------------------------- */
  function renderPreview(preview) {
    var area = document.getElementById("previewArea");
    var grid = document.getElementById("previewGrid");
    area.hidden = false;
    clear(grid);
    [
      ["Linhas lidas", preview.job.totalRows],
      ["Validas", preview.job.validRows],
      ["Invalidas", preview.job.invalidRows],
      ["Duplicadas", preview.job.duplicateRows],
      [preview.points.simulated ? "Pontos (simulacao)" : "Pontos a lancar", preview.points.total]
    ].forEach(function (pair) {
      var box = document.createElement("div");
      var value = document.createElement("strong");
      value.textContent = String(pair[1]);
      var label = document.createElement("span");
      label.textContent = pair[0];
      box.appendChild(value); box.appendChild(label);
      grid.appendChild(box);
    });

    var errors = document.getElementById("previewErrors");
    clear(errors);
    var note = document.createElement("p");
    note.className = "muted";
    note.textContent = preview.points.note;
    errors.appendChild(note);

    if (preview.errors.length) {
      var title = document.createElement("p");
      title.textContent = "Erros por codigo (sem exibir conteudo da planilha):";
      errors.appendChild(title);
      var list = document.createElement("ul");
      preview.errors.forEach(function (error) {
        var item = document.createElement("li");
        item.textContent = error.error_code + " em " + error.error_field + ": " + error.c + " linha(s)";
        list.appendChild(item);
      });
      errors.appendChild(list);
    }

    state.canConfirm = preview.canConfirm;
    var button = document.getElementById("confirmImport");
    var attestation = document.getElementById("attestConference");
    attestation.checked = false;
    button.disabled = true;
    document.getElementById("confirmHint").textContent = preview.canConfirm
      ? "Ateste a conferencia para habilitar a aplicacao."
      : "Confirmacao bloqueada: regra " + (preview.blockedBy[0] || "pendente") + " nao aprovada (D-04).";
  }

  async function uploadFile(file) {
    if (!file) return;
    var result = document.getElementById("importResult");
    result.hidden = false;
    result.textContent = "Enviando e validando no servidor…";
    document.getElementById("previewArea").hidden = true;
    try {
      var form = new FormData();
      form.append("referenceDate", new Date().toISOString().slice(0, 10));
      form.append("file", file, file.name);
      var job = await api("/api/v1/admin/imports", { method: "POST", body: form });
      state.jobId = job.id;
      result.textContent = job.replay
        ? "Arquivo identico ja enviado antes: reaproveitando a importacao " + job.id.slice(0, 8) +
          " (idempotencia). Status: " + job.status + "."
        : "Validacao concluida. Status: " + job.status + ". Nada foi aplicado ainda.";
      var warnings = (job.summary && job.summary.warnings) || [];
      if (warnings.length) result.textContent += " " + warnings.join(" ");
      renderPreview(await api("/api/v1/admin/imports/" + job.id + "/preview"));
      await loadHistory();
    } catch (error) {
      result.textContent = "Importacao recusada: " + error.message;
      handleError(error);
    }
  }

  async function confirmImport() {
    if (!state.jobId || !state.canConfirm) return;
    // MED-09: confirmacao explica o impacto ANTES de executar.
    var confirmed = window.confirm(
      "Confirmar a aplicacao desta importacao?\n\n" +
      "Serao criadas indicacoes definitivas, com autoria registrada na trilha de auditoria. " +
      "Correcoes posteriores exigem lancamento compensatorio: nada e apagado."
    );
    if (!confirmed) return;

    var attestation = document.getElementById("attestConference");
    if (!attestation.checked) {
      setBanner("Confirme a conferencia manual antes de aplicar a importacao.", "error");
      attestation.focus();
      return;
    }
    var note = document.getElementById("conferenceNote").value.trim();
    try {
      var result = await api("/api/v1/admin/imports/" + state.jobId + "/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attestConference: true,
          conferenceNote: note || undefined
        })
      });
      var conferencia = result.conference || {};
      document.getElementById("importResult").textContent =
        "Importacao concluida: " + result.created + " indicacoes criadas, " +
        result.ledgerEntries + " lancamentos de pontos, " +
        result.titularityConflicts + " conflitos enviados para decisao. " +
        (conferencia.attested
          ? conferencia.conferred + " linhas conferidas e registradas. " +
            conferencia.stillPending + " oportunidades aguardam validacao comercial."
          : "Nenhuma conferencia atestada: as oportunidades seguem pendentes de validacao.");
      document.getElementById("previewArea").hidden = true;
      state.jobId = null;
      await loadReport();
      await loadHistory();
    } catch (error) {
      document.getElementById("importResult").textContent = "Confirmacao recusada: " + error.message;
      handleError(error);
    }
  }

  /* --------------------------------- sessao --------------------------------- */

  /* ---------------------------------------------------------------------- */
  /* FE-04 / FE-05: cadastro de participantes e gestao de indicacoes.        */
  /* Toda alcada e verificada no servidor; a interface apenas reflete o 403. */
  /* ---------------------------------------------------------------------- */
  var STAGE_LABELS = {
    identified: "Oportunidade identificada",
    meeting_scheduled: "Reuniao agendada",
    meeting_held: "Reuniao realizada",
    proposal_sent: "Proposta enviada",
    sale_won: "Venda realizada",
    lost: "Perdida"
  };
  var NEXT_STAGE = {
    identified: "meeting_scheduled",
    meeting_scheduled: "meeting_held",
    meeting_held: "proposal_sent",
    proposal_sent: "sale_won"
  };

  function busy(button, on, labelWhenBusy) {
    // FE-08: enquanto a requisicao esta em voo o botao fica desabilitado.
    if (!button) return;
    if (on) {
      button.dataset.label = button.textContent;
      button.textContent = labelWhenBusy || "Enviando...";
      button.disabled = true;
    } else {
      button.textContent = button.dataset.label || button.textContent;
      button.disabled = false;
    }
  }

  async function loadStaff() {
    var body = document.getElementById("staffBody");
    var search = document.getElementById("staffSearch").value.trim();
    var url = "/api/v1/admin/staff?pageSize=25" + (search ? "&q=" + encodeURIComponent(search) : "");
    var data = await api(url);
    clear(body);
    if (!data.items.length) {
      var empty = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 6;
      td.textContent = "Nenhum participante encontrado.";
      empty.appendChild(td);
      body.appendChild(empty);
      return;
    }
    data.items.forEach(function (person) {
      var row = document.createElement("tr");
      cell(row, person.external_code);
      cell(row, person.display_name);
      cell(row, person.business_unit);
      cell(row, person.referrals);
      cell(row, person.status === "active" ? "Ativo" : "Inativo");
      var actions = document.createElement("td");
      if (person.status === "active") {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "secondary-button";
        button.textContent = "Inativar";
        button.addEventListener("click", function () { inactivateStaff(person, button); });
        actions.appendChild(button);
      } else {
        actions.textContent = "—";
      }
      row.appendChild(actions);
      body.appendChild(row);
    });
  }

  async function createStaff() {
    var button = document.getElementById("createStaff");
    var code = document.getElementById("staffCode").value.trim();
    var name = document.getElementById("staffName").value.trim();
    var unit = document.getElementById("staffUnit").value.trim();
    var hint = document.getElementById("staffHint");
    if (!code || !name) {
      hint.textContent = "Informe matricula e nome.";
      return;
    }
    busy(button, true, "Cadastrando...");
    try {
      await api("/api/v1/admin/staff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ externalCode: code, displayName: name, businessUnit: unit || undefined })
      });
      document.getElementById("staffCode").value = "";
      document.getElementById("staffName").value = "";
      document.getElementById("staffUnit").value = "";
      hint.textContent = "Participante cadastrado.";
      setBanner("Participante cadastrado com autoria registrada na auditoria.", "info");
      await loadStaff();
      await loadHistory();
    } catch (error) {
      hint.textContent = error.message;
      handleError(error);
    } finally {
      busy(button, false);
    }
  }

  async function inactivateStaff(person, button) {
    // MED-09 / FE-07: a confirmacao explica o impacto real antes de executar.
    var confirmed = window.confirm(
      "Inativar " + person.display_name + " (" + person.external_code + ")?\n\n" +
      "O historico de indicacoes, pontos e auditoria e PRESERVADO — nada e apagado.\n" +
      "A pessoa deixa de aparecer no ranking e nao pode receber novas indicacoes.\n" +
      "A acao fica registrada na trilha de auditoria com o seu usuario."
    );
    if (!confirmed) return;
    var reason = window.prompt("Motivo da inativacao (obrigatorio, minimo 3 caracteres):", "");
    if (!reason || reason.trim().length < 3) {
      setBanner("Inativacao cancelada: o motivo e obrigatorio.", "warn");
      return;
    }
    busy(button, true, "Inativando...");
    try {
      await api("/api/v1/admin/staff/" + person.id, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "inactive", inactivationReason: reason.trim() })
      });
      setBanner("Participante inativado. Historico preservado.", "info");
      await loadStaff();
      await loadHistory();
    } catch (error) {
      handleError(error);
    } finally {
      busy(button, false);
    }
  }

  async function loadReferrals() {
    var body = document.getElementById("referralBody");
    var stage = document.getElementById("referralStage").value;
    var search = document.getElementById("referralSearch").value.trim();
    var url = "/api/v1/admin/referrals?pageSize=25" +
      (stage ? "&stage=" + encodeURIComponent(stage) : "") +
      (search ? "&q=" + encodeURIComponent(search) : "");
    var data = await api(url);
    document.getElementById("referralsTotal").textContent = data.total + " indicacoes ativas";
    clear(body);
    if (!data.items.length) {
      var empty = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 7;
      td.textContent = "Nenhuma indicacao para este filtro.";
      empty.appendChild(td);
      body.appendChild(empty);
      return;
    }
    data.items.forEach(function (referral) {
      var row = document.createElement("tr");
      cell(row, referral.staffName + " (" + referral.staffCode + ")");
      cell(row, referral.reference || "nao informada");
      cell(row, referral.serviceName);
      cell(row, referral.territoryName);
      cell(row, STAGE_LABELS[referral.stage] || referral.stage);
      cell(row, new Date(referral.occurredAt).toLocaleDateString("pt-BR"));
      var actions = document.createElement("td");
      var next = NEXT_STAGE[referral.stage];
      if (next) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "secondary-button";
        button.textContent = STAGE_LABELS[next];
        button.addEventListener("click", function () { advanceReferral(referral, next, button); });
        actions.appendChild(button);
      } else {
        actions.textContent = "etapa final";
      }
      row.appendChild(actions);
      body.appendChild(row);
    });
  }

  async function advanceReferral(referral, next, button) {
    var confirmed = window.confirm(
      "Avancar a indicacao de " + referral.staffName + " para \"" + STAGE_LABELS[next] + "\"?\n\n" +
      "A transicao gera um evento historico imutavel com o seu usuario.\n" +
      "Se a regra de pontuacao estiver aprovada, ela tambem gera lancamento no ledger."
    );
    if (!confirmed) return;
    busy(button, true, "Aplicando...");
    try {
      var result = await api("/api/v1/admin/referrals/" + referral.id + "/transitions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toStage: next, occurredAt: new Date().toISOString().slice(0, 10) })
      });
      document.getElementById("transitionHint").textContent = result.pointsRuleApproved
        ? "Transicao aplicada e pontos lancados pela regra vigente."
        : "Transicao aplicada. Nenhum ponto foi lancado: RULE_POINTS_ACCRUAL nao esta aprovada (D-03).";
      setBanner("Transicao registrada com autoria de sessao.", "info");
      await loadReferrals();
      await loadReport();
      await loadHistory();
    } catch (error) {
      if (error.code === 422 && error.payload && error.payload.error &&
          error.payload.error.code === "PENDING_BUSINESS_RULE") {
        document.getElementById("transitionHint").textContent = error.message;
        setBanner(error.message, "warn");
      } else {
        handleError(error);
      }
    } finally {
      busy(button, false);
    }
  }

  async function boot() {
    try {
      var session = await api("/api/v1/auth/session");
      if (!session.authenticated) {
        setBanner("Sessao encerrada. Recarregue a pagina para entrar novamente.", "error");
        return;
      }
      text("sessionName", session.displayName);
      document.getElementById("sessionRoles").textContent = session.roles.join(", ") || "sem papel";
      document.getElementById("sessionInitials").textContent =
        session.displayName.split(/\s+/).slice(0, 2).map(function (p) { return p.charAt(0); })
          .join("").toUpperCase();
      document.getElementById("referenceDate").value = new Date().toISOString().slice(0, 10);
      await loadReport();
      await loadRules();
      await loadHistory();
      await loadStaff();
      await loadReferrals();
    } catch (error) {
      handleError(error);
    }
  }

  document.querySelectorAll("[data-cycle]").forEach(function (button) {
    button.addEventListener("click", function () {
      document.querySelectorAll("[data-cycle]").forEach(function (other) {
        other.classList.toggle("active", other === button);
      });
      state.periodicity = button.getAttribute("data-cycle");
      loadReport().catch(handleError);
    });
  });
  document.getElementById("referenceDate").addEventListener("change", function (event) {
    state.reference = event.target.value || null;
    loadReport().catch(handleError);
  });
  document.getElementById("selectFile").addEventListener("click", function () {
    document.getElementById("fileInput").click();
  });
  document.getElementById("fileInput").addEventListener("change", function (event) {
    uploadFile(event.target.files && event.target.files[0]);
  });
  var dropZone = document.getElementById("dropZone");
  ["dragenter", "dragover"].forEach(function (name) {
    dropZone.addEventListener(name, function (event) {
      event.preventDefault(); dropZone.classList.add("dragging");
    });
  });
  ["dragleave", "drop"].forEach(function (name) {
    dropZone.addEventListener(name, function (event) {
      event.preventDefault(); dropZone.classList.remove("dragging");
    });
  });
  dropZone.addEventListener("drop", function (event) {
    uploadFile(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]);
  });
  document.getElementById("confirmImport").addEventListener("click", confirmImport);
  document.getElementById("attestConference").addEventListener("change", function (event) {
    document.getElementById("confirmImport").disabled = !state.canConfirm || !event.target.checked;
    document.getElementById("confirmHint").textContent = event.target.checked && state.canConfirm
      ? "Conferencia atestada. A aplicacao registrara sua autoria."
      : "Ateste a conferencia para habilitar a aplicacao.";
  });
  document.getElementById("createStaff").addEventListener("click", createStaff);
  document.getElementById("staffSearch").addEventListener("input", debounce(function () {
    loadStaff().catch(handleError);
  }, 300));
  document.getElementById("referralStage").addEventListener("change", function () {
    loadReferrals().catch(handleError);
  });
  document.getElementById("referralSearch").addEventListener("input", debounce(function () {
    loadReferrals().catch(handleError);
  }, 300));
  document.getElementById("logoutButton").addEventListener("click", async function () {
    await api("/api/v1/auth/logout", { method: "POST" }).catch(function () { return null; });
    window.location.href = "/";
  });
  document.getElementById("mobileMenu").addEventListener("click", function () {
    document.body.classList.toggle("menu-open");
    document.getElementById("mobileOverlay").hidden = !document.body.classList.contains("menu-open");
  });
  document.getElementById("mobileOverlay").addEventListener("click", function () {
    document.body.classList.remove("menu-open");
    document.getElementById("mobileOverlay").hidden = true;
  });
  document.getElementById("collapseSidebar").addEventListener("click", function () {
    document.body.classList.toggle("sidebar-collapsed");
  });

  boot();
}());
