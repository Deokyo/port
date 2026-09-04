(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var MAP_SHAPES = [
    { d: "M79 137l90-58 116 24 56 76-43 73-79 1-36 52-74-36-38-72z", x: 205, y: 168 },
    { d: "M397 123l75-50 82 18 48 62-45 59-39-19-39 45-85-27z", x: 493, y: 143 },
    { d: "M238 302l77-20 74 45-12 75-58 102-43-42-14-87z", x: 314, y: 382 },
    { d: "M465 238l90-12 62 55-15 130-78 88-61-101-31-95z", x: 530, y: 333 }
  ];
  var STAGE_LABELS = {
    identified: "Oportunidade identificada",
    meeting_scheduled: "Reuniao agendada",
    meeting_held: "Reuniao realizada",
    proposal_sent: "Proposta enviada",
    sale_won: "Venda realizada",
    lost: "Perdida"
  };
  var state = {
    session: null,
    summary: null,
    me: null,
    achievements: { ruleApproved: false, items: [] },
    notifications: [],
    referrals: [],
    mapLevel: "world",
    territorySlug: null,
    serviceSlug: null,
    periodicity: "monthly"
  };
  var toastTimer = 0;

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function svgElement(tag, attributes) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attributes || {}).forEach(function (key) {
      node.setAttribute(key, String(attributes[key]));
    });
    return node;
  }

  function api(path, options) {
    var request = Object.assign({ credentials: "same-origin", headers: { accept: "application/json" } }, options || {});
    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, 15000);
    request.signal = controller.signal;
    return fetch(path, request).then(function (response) {
      if (!response.ok) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          var error = new Error(payload.error && payload.error.message || "Falha na consulta");
          error.status = response.status;
          throw error;
        });
      }
      return response.status === 204 ? null : response.json();
    }).catch(function (error) {
      if (error && error.name === "AbortError") {
        var timeoutError = new Error("O servidor local demorou mais de 15 segundos para responder.");
        timeoutError.status = 504;
        throw timeoutError;
      }
      throw error;
    }).finally(function () {
      window.clearTimeout(timeout);
    });
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
  }

  function formatPercent(value) {
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(Number(value || 0)) + "%";
  }

  function formatDate(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Data indisponivel";
    return date.toLocaleDateString("pt-BR");
  }

  function initials(name) {
    return String(name || "").split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (part) { return part.charAt(0); }).join("").toUpperCase() || "--";
  }

  function normalized(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  function showToast(title, message) {
    var toast = document.getElementById("toast");
    document.getElementById("toastTitle").textContent = title;
    document.getElementById("toastText").textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toast.hidden = true; }, 4200);
  }

  function setLogin(session) {
    document.getElementById("appShell").hidden = true;
    var login = document.getElementById("authState");
    login.hidden = false;
    var action = document.getElementById("authAction");
    var message = document.getElementById("authMessage");
    message.textContent = session.notice || "A autenticacao ainda nao foi configurada.";
    action.hidden = !session.loginUrl;
    if (session.loginUrl) action.href = session.loginUrl;
    action.firstChild.textContent = session.localLoginAvailable
      ? "Entrar no ambiente local "
      : "Entrar com conta corporativa ";
    document.getElementById("loginEnvironment").textContent = session.localLoginAvailable
      ? "Piloto local"
      : "Acesso corporativo";
    document.getElementById("loginNote").textContent = session.localLoginAvailable
      ? "Este acesso sintetico funciona somente neste computador e nao representa o login de producao."
      : "Sua sessao e protegida pelo provedor de identidade configurado pela organizacao.";
  }

  function showFatal(error) {
    setLogin({ loginUrl: null, notice: error.message + (error.status ? " (HTTP " + error.status + ")" : "") });
    document.getElementById("authTitle").textContent = "Nao foi possivel abrir o WIN Board";
    document.getElementById("loginEnvironment").textContent = "Falha de conexao";
  }

  function showApp() {
    document.getElementById("authState").hidden = true;
    document.getElementById("appShell").hidden = false;
  }

  function emptyState(symbol, title, message) {
    var box = element("div", "empty-state");
    box.appendChild(element("div", "empty-symbol", symbol));
    box.appendChild(element("h2", "", title));
    box.appendChild(element("p", "", message));
    return box;
  }

  function metric(label, value) {
    var row = element("div", "metric");
    row.appendChild(element("span", "", label));
    row.appendChild(element("strong", "", value));
    return row;
  }

  function selectedTerritory() {
    return (state.summary.territories || []).find(function (territory) {
      return territory.slug === state.territorySlug;
    }) || null;
  }

  function selectedService() {
    var territory = selectedTerritory();
    return territory && territory.services.find(function (service) {
      return service.slug === state.serviceSlug;
    }) || null;
  }

  function referralsFor(service, territory) {
    return state.referrals.filter(function (referral) {
      return referral.serviceName === service.name && referral.territoryName === territory.name;
    });
  }

  function setView(name) {
    document.querySelectorAll("[data-view-panel]").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-view-panel") !== name;
    });
    document.querySelectorAll("[data-view]").forEach(function (control) {
      control.classList.toggle("active", control.getAttribute("data-view") === name);
    });
    document.getElementById("notificationPanel").hidden = true;
    document.getElementById("notificationButton").setAttribute("aria-expanded", "false");
  }

  function renderSession() {
    document.getElementById("sessionName").textContent = state.session.displayName;
    document.getElementById("sessionRoles").textContent = (state.session.roles || []).join(", ") || "sem papel";
    document.getElementById("sessionInitials").textContent = initials(state.session.displayName);
    document.getElementById("profileGreeting").textContent = "Ola, " + state.session.displayName.split(/\s+/)[0];
    var canAdmin = (state.session.permissions || []).indexOf("admin:access") >= 0;
    document.getElementById("adminLink").hidden = !canAdmin;
    document.getElementById("boardAdminLink").hidden = !canAdmin;
  }

  function renderGlobalState() {
    document.getElementById("cycleLabel").textContent = state.summary.cycle.label;
    document.getElementById("rankingCycle").textContent = state.summary.cycle.label;
    var banner = document.getElementById("globalState");
    banner.hidden = !state.summary.rules.notice;
    banner.textContent = state.summary.rules.notice || "";
  }

  function renderBreadcrumbs() {
    var mount = document.getElementById("breadcrumbs");
    mount.replaceChildren();
    var home = element("button", "", "Visao global");
    home.type = "button";
    home.addEventListener("click", openWorld);
    mount.appendChild(home);
    var territory = selectedTerritory();
    if (territory) {
      mount.appendChild(element("i", "", "/"));
      if (state.mapLevel === "service") {
        var territoryButton = element("button", "", territory.name);
        territoryButton.type = "button";
        territoryButton.addEventListener("click", function () { openTerritory(territory.slug); });
        mount.appendChild(territoryButton);
      } else {
        mount.appendChild(element("strong", "", territory.name));
      }
    }
    var service = selectedService();
    if (service) {
      mount.appendChild(element("i", "", "/"));
      mount.appendChild(element("strong", "", service.name));
    }
    document.getElementById("backMap").hidden = state.mapLevel === "world";
  }

  function renderWorld() {
    var stage = document.getElementById("mapStage");
    var territories = state.summary.territories || [];
    if (!territories.length) {
      stage.appendChild(emptyState("!", "Catalogo indisponivel", "Nenhum territorio ativo foi encontrado."));
      return;
    }
    var svg = svgElement("svg", { class: "world-map", viewBox: "0 0 1000 560", role: "img", "aria-labelledby": "worldTitle worldDesc" });
    var title = svgElement("title", { id: "worldTitle" });
    title.textContent = "Mapa dos territorios do Programa WIN";
    var desc = svgElement("desc", { id: "worldDesc" });
    desc.textContent = "Quatro areas clicaveis representam Performance, Governanca, Expansao e Pessoas.";
    svg.appendChild(title);
    svg.appendChild(desc);
    var grid = svgElement("g", { class: "world-grid" });
    [[500,280,460,220],[500,280,330,220],[500,280,180,220]].forEach(function (ellipse) {
      grid.appendChild(svgElement("ellipse", { cx: ellipse[0], cy: ellipse[1], rx: ellipse[2], ry: ellipse[3] }));
    });
    ["M40 200h920", "M20 280h960", "M40 360h920"].forEach(function (d) {
      grid.appendChild(svgElement("path", { d: d }));
    });
    svg.appendChild(grid);
    svg.appendChild(svgElement("path", { class: "world-route", d: "M188 211C357 104 572 125 731 203S862 388 862 388" }));

    var tooltip = element("div", "map-tooltip");
    tooltip.setAttribute("aria-hidden", "true");
    stage.appendChild(tooltip);

    territories.slice(0, MAP_SHAPES.length).forEach(function (territory, index) {
      var shape = MAP_SHAPES[index];
      var group = svgElement("g", {
        class: "world-territory color-" + index,
        tabindex: "0",
        role: "button",
        "aria-label": territory.name + ", " + territory.servicesTotal + " servicos"
      });
      group.appendChild(svgElement("path", { d: shape.d }));
      var label = svgElement("text", { x: shape.x, y: shape.y });
      label.textContent = territory.name;
      group.appendChild(label);
      var count = svgElement("text", { class: "map-count", x: shape.x, y: shape.y + 20 });
      count.textContent = territory.servicesTotal + " servicos";
      group.appendChild(count);
      function open() { openTerritory(territory.slug); }
      function showTip() {
        tooltip.replaceChildren();
        tooltip.appendChild(element("strong", "", territory.name));
        tooltip.appendChild(element("span", "", territory.servicesTotal + " servicos. Clique para explorar o catalogo."));
        tooltip.classList.add("show");
      }
      function hideTip() { tooltip.classList.remove("show"); }
      group.addEventListener("click", open);
      group.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
      });
      group.addEventListener("pointerenter", showTip);
      group.addEventListener("focus", showTip);
      group.addEventListener("pointerleave", hideTip);
      group.addEventListener("blur", hideTip);
      svg.appendChild(group);
      svg.appendChild(svgElement("circle", { class: "world-point", cx: shape.x - 22, cy: shape.y + 35, r: 5 }));
    });
    stage.appendChild(svg);
  }

  function renderTerritory(territory) {
    var stage = document.getElementById("mapStage");
    var shell = element("div", "territory-stage");
    var head = element("header", "territory-head");
    var copy = element("div");
    copy.appendChild(element("p", "panel-kicker", "Territorio selecionado"));
    copy.appendChild(element("h2", "", territory.name));
    copy.appendChild(element("p", "", "Escolha um servico para consultar as indicacoes vinculadas a sua sessao."));
    head.appendChild(copy);
    var stateBox = element("div", "territory-state");
    stateBox.appendChild(element("strong", "", territory.servicesTotal));
    stateBox.appendChild(element("span", "", "servicos no catalogo"));
    head.appendChild(stateBox);
    shell.appendChild(head);
    var grid = element("div", "service-grid");
    territory.services.forEach(function (service) {
      var own = referralsFor(service, territory);
      var button = element("button", "service-button" + (service.won ? " has-win" : ""));
      button.type = "button";
      button.appendChild(element("span", "service-status", service.won ? "Venda registrada" : "Sem venda registrada"));
      button.appendChild(element("strong", "", service.name));
      button.appendChild(element("small", "", own.length
        ? own.length + " indicacao(oes) vinculada(s) a voce"
        : "Nenhuma indicacao vinculada a voce"));
      button.addEventListener("click", function () { openService(service.slug); });
      grid.appendChild(button);
    });
    shell.appendChild(grid);
    stage.appendChild(shell);
  }

  function renderService(territory, service) {
    var stage = document.getElementById("mapStage");
    var shell = element("div", "service-stage");
    var head = element("header", "service-head");
    var copy = element("div");
    copy.appendChild(element("p", "panel-kicker", territory.name));
    copy.appendChild(element("h2", "", service.name));
    copy.appendChild(element("p", "", "Indicacoes da sua matricula. A etapa exibida e o estado atual, nao um historico completo de transicoes."));
    head.appendChild(copy);
    shell.appendChild(head);
    var referrals = referralsFor(service, territory);
    if (!referrals.length) {
      shell.appendChild(emptyState("0", "Nenhuma indicacao sua", "O servico existe no catalogo, mas nao ha indicacoes vinculadas a sua matricula."));
    } else {
      var flow = element("div", "referral-flow");
      referrals.forEach(function (referral) {
        var row = element("article", "referral-row");
        var detail = element("div");
        detail.appendChild(element("strong", "", STAGE_LABELS[referral.stage] || referral.stage));
        detail.appendChild(element("span", "", service.name + " · " + territory.name));
        row.appendChild(detail);
        row.appendChild(element("time", "", formatDate(referral.occurredAt)));
        flow.appendChild(row);
      });
      shell.appendChild(flow);
    }
    stage.appendChild(shell);
  }

  function renderSidePanel() {
    var metrics = document.getElementById("panelMetrics");
    metrics.replaceChildren();
    var kicker = document.getElementById("panelKicker");
    var title = document.getElementById("panelTitle");
    var text = document.getElementById("panelText");
    var territory = selectedTerritory();
    var service = selectedService();
    if (!territory) {
      kicker.textContent = "Visao global";
      title.textContent = "Territorios Locatelli";
      text.textContent = "Selecione uma area do mapa para abrir o catalogo e aprofundar a jornada.";
      metrics.appendChild(metric("Indicacoes no ciclo", formatNumber(state.summary.totals.referrals)));
      metrics.appendChild(metric("Vendas no ciclo", formatNumber(state.summary.totals.wins)));
      metrics.appendChild(metric("Conversao no ciclo", formatPercent(state.summary.totals.conversion)));
      metrics.appendChild(metric("Pontos", state.summary.rules.pointsApproved ? formatNumber(state.summary.totals.points) : "Regra pendente"));
    } else if (!service) {
      kicker.textContent = "Territorio selecionado";
      title.textContent = territory.name;
      text.textContent = "Os indicadores territoriais abaixo sao acumulados e nao representam conquista enquanto a regra estiver pendente.";
      metrics.appendChild(metric("Servicos", formatNumber(territory.servicesTotal)));
      metrics.appendChild(metric("Com venda registrada", formatNumber(territory.servicesWithWin)));
      metrics.appendChild(metric("Estado de conquista", territory.stateRuleApproved ? territory.state : "Regra pendente"));
    } else {
      var own = referralsFor(service, territory);
      kicker.textContent = "Servico selecionado";
      title.textContent = service.name;
      text.textContent = "Consulte fatos registrados sem converter venda ou etapa em conquista automaticamente.";
      metrics.appendChild(metric("Territorio", territory.name));
      metrics.appendChild(metric("Venda registrada", service.won ? "Sim" : "Nao"));
      metrics.appendChild(metric("Suas indicacoes", formatNumber(own.length)));
    }
    var ruleApproved = (state.summary.territories || []).some(function (item) { return item.stateRuleApproved; });
    document.getElementById("ruleTitle").textContent = ruleApproved ? "Regra territorial vigente" : "Regra territorial pendente";
    document.getElementById("ruleText").textContent = ruleApproved
      ? "Os estados de conquista seguem a revisao aprovada registrada no servidor."
      : "Vendas e indicacoes ficam visiveis, mas nenhum territorio e marcado como conquistado sem uma regra aprovada.";
  }

  function renderMap() {
    var stage = document.getElementById("mapStage");
    stage.replaceChildren();
    renderBreadcrumbs();
    var territory = selectedTerritory();
    var service = selectedService();
    if (state.mapLevel === "territory" && territory) renderTerritory(territory);
    else if (state.mapLevel === "service" && territory && service) renderService(territory, service);
    else renderWorld();
    renderSidePanel();
  }

  function openWorld() {
    state.mapLevel = "world";
    state.territorySlug = null;
    state.serviceSlug = null;
    renderMap();
  }

  function openTerritory(slug) {
    state.mapLevel = "territory";
    state.territorySlug = slug;
    state.serviceSlug = null;
    renderMap();
    showToast("Territorio aberto", selectedTerritory().name + " agora mostra seus servicos.");
  }

  function openService(slug) {
    state.mapLevel = "service";
    state.serviceSlug = slug;
    renderMap();
    showToast("Servico aberto", selectedService().name + " agora mostra suas indicacoes.");
  }

  function renderSearchOptions() {
    var list = document.getElementById("mapSearchOptions");
    list.replaceChildren();
    (state.summary.territories || []).forEach(function (territory) {
      var territoryOption = element("option");
      territoryOption.value = territory.name;
      list.appendChild(territoryOption);
      territory.services.forEach(function (service) {
        var option = element("option");
        option.value = service.name;
        list.appendChild(option);
      });
    });
  }

  function runSearch() {
    var input = document.getElementById("mapSearch");
    var term = normalized(input.value);
    if (!term) return;
    var territories = state.summary.territories || [];
    var territory = territories.find(function (item) { return normalized(item.name) === term; });
    if (territory) {
      openTerritory(territory.slug);
      input.value = "";
      return;
    }
    for (var i = 0; i < territories.length; i += 1) {
      var service = territories[i].services.find(function (item) { return normalized(item.name) === term; });
      if (service) {
        state.territorySlug = territories[i].slug;
        openService(service.slug);
        input.value = "";
        return;
      }
    }
    showToast("Busca sem resultado", "Use o nome completo de um territorio ou servico do catalogo.");
  }

  function renderRanking() {
    var mount = document.getElementById("rankingContent");
    mount.replaceChildren();
    if (!state.summary.rules.pointsApproved || !state.summary.rules.rankingApproved) {
      var pending = emptyState("#", "Ranking aguardando aprovacao", "O placar sera publicado quando as regras de pontuacao, ciclo e desempate estiverem aprovadas e vigentes.");
      var territories = element("div", "pending-territories");
      (state.summary.territories || []).forEach(function (territory) {
        territories.appendChild(element("span", "", territory.name));
      });
      pending.appendChild(territories);
      mount.appendChild(pending);
      return;
    }
    var items = state.summary.ranking || [];
    if (!items.length) {
      mount.appendChild(emptyState("0", "Sem participantes no ciclo", "Ainda nao existem fatos suficientes para compor o ranking."));
      return;
    }
    var podium = element("section", "podium-stage");
    items.slice(0, 3).forEach(function (participant) {
      var entry = element("article", "podium-entry");
      entry.appendChild(element("div", "podium-avatar", participant.initials));
      entry.appendChild(element("h2", "", participant.displayName));
      entry.appendChild(element("p", "", formatNumber(participant.referrals) + " indicacoes"));
      var block = element("div", "podium-block");
      block.appendChild(element("strong", "", participant.position + "º"));
      block.appendChild(element("span", "", formatNumber(participant.points) + " pontos"));
      entry.appendChild(block);
      podium.appendChild(entry);
    });
    mount.appendChild(podium);
    var table = element("table", "ranking-table");
    var head = element("thead");
    var headRow = element("tr");
    ["Posicao", "Participante", "Indicacoes", "Pontos"].forEach(function (label) { headRow.appendChild(element("th", "", label)); });
    head.appendChild(headRow);
    table.appendChild(head);
    var body = element("tbody");
    items.forEach(function (participant) {
      var row = element("tr");
      row.appendChild(element("td", "", String(participant.position).padStart(2, "0")));
      var cell = element("td");
      var person = element("div", "person-cell");
      person.appendChild(element("span", "mini-avatar", participant.initials));
      person.appendChild(element("strong", "", participant.displayName + (participant.isCurrentUser ? " (voce)" : "")));
      cell.appendChild(person);
      row.appendChild(cell);
      row.appendChild(element("td", "", formatNumber(participant.referrals)));
      row.appendChild(element("td", "", formatNumber(participant.points)));
      body.appendChild(row);
    });
    table.appendChild(body);
    mount.appendChild(table);
  }

  function renderAchievements() {
    var mount = document.getElementById("achievementsGrid");
    mount.replaceChildren();
    if (!state.achievements || !state.achievements.ruleApproved) {
      var pending = emptyState("◇", "Conquistas aguardando regra", state.achievements && state.achievements.notice || "Nenhuma conquista sera concedida antes da aprovacao da regra territorial.");
      var territories = element("div", "pending-territories");
      (state.summary.territories || []).forEach(function (territory) { territories.appendChild(element("span", "", territory.name)); });
      pending.appendChild(territories);
      mount.appendChild(pending);
      return;
    }
    if (!state.achievements.items || !state.achievements.items.length) {
      mount.appendChild(emptyState("0", "Nenhuma conquista ainda", "As conquistas concedidas aparecerao neste espaco."));
      return;
    }
    var grid = element("div", "achievement-grid");
    state.achievements.items.forEach(function (item) {
      var card = element("article", "achievement");
      card.appendChild(element("span", "", "Conquistada em " + formatDate(item.granted_at)));
      card.appendChild(element("h2", "", item.name));
      card.appendChild(element("p", "", item.description));
      grid.appendChild(card);
    });
    mount.appendChild(grid);
  }

  function renderProfile() {
    var mount = document.getElementById("profileContent");
    mount.replaceChildren();
    if (!state.me || !state.me.linked) {
      mount.appendChild(emptyState("!", "Identidade nao vinculada", state.me && state.me.notice || "Vincule a identidade a uma matricula para mostrar o perfil."));
      return;
    }
    var card = element("aside", "profile-card");
    card.appendChild(element("div", "profile-avatar", initials(state.session.displayName)));
    card.appendChild(element("h2", "", state.session.displayName));
    card.appendChild(element("p", "", state.me.staffCode || "Matricula nao informada"));
    var cardMetrics = element("div", "metric-list");
    cardMetrics.appendChild(metric("Indicacoes acumuladas", formatNumber(state.me.referrals)));
    cardMetrics.appendChild(metric("Vendas acumuladas", formatNumber(state.me.wins)));
    cardMetrics.appendChild(metric("Pontos", state.summary.rules.pointsApproved ? formatNumber(state.me.points) : "Regra pendente"));
    card.appendChild(cardMetrics);
    var logout = element("button", "logout-button", "Encerrar sessao");
    logout.type = "button";
    logout.addEventListener("click", logoutSession);
    card.appendChild(logout);
    var content = element("section", "profile-content");
    content.appendChild(element("p", "panel-kicker", "Historico acumulado"));
    content.appendChild(element("h2", "", "Seu momento no Programa WIN"));
    var stats = element("div", "profile-stats");
    [["Indicacoes", state.me.referrals], ["Vendas", state.me.wins], ["Territorios", (state.me.territories || []).length]].forEach(function (entry) {
      var item = element("article");
      item.appendChild(element("span", "", entry[0]));
      item.appendChild(element("strong", "", formatNumber(entry[1])));
      stats.appendChild(item);
    });
    content.appendChild(stats);
    content.appendChild(element("div", "activity-heading", "Indicacoes recentes"));
    var list = element("div", "activity-list");
    if (!state.referrals.length) {
      list.appendChild(element("div", "notification-item", "Nenhuma indicacao vinculada a esta matricula."));
    } else {
      state.referrals.slice(0, 8).forEach(function (referral) {
        var row = element("article", "activity");
        var info = element("div");
        info.appendChild(element("strong", "", referral.serviceName));
        info.appendChild(element("span", "", referral.territoryName + " · " + (STAGE_LABELS[referral.stage] || referral.stage)));
        row.appendChild(info);
        row.appendChild(element("time", "", formatDate(referral.occurredAt)));
        list.appendChild(row);
      });
    }
    content.appendChild(list);
    mount.appendChild(card);
    mount.appendChild(content);
  }

  function renderNotifications() {
    var mount = document.getElementById("notificationList");
    mount.replaceChildren();
    var unread = state.notifications.filter(function (item) { return !item.read_at; }).length;
    var badge = document.getElementById("notificationBadge");
    badge.hidden = unread === 0;
    badge.textContent = String(unread);
    if (!state.notifications.length) {
      mount.appendChild(element("div", "notification-item", "Nenhuma notificacao por enquanto."));
      return;
    }
    state.notifications.forEach(function (item) {
      var card = element("article", "notification-item");
      card.appendChild(element("strong", "", item.title));
      card.appendChild(element("span", "", item.body));
      card.appendChild(element("time", "", formatDate(item.created_at)));
      mount.appendChild(card);
    });
  }

  function logoutSession() {
    api("/api/v1/auth/logout", { method: "POST" }).finally(function () { location.href = "/"; });
  }

  function bindControls() {
    document.querySelectorAll("[data-view]").forEach(function (control) {
      control.addEventListener("click", function (event) {
        event.preventDefault();
        setView(control.getAttribute("data-view"));
      });
    });
    document.getElementById("notificationButton").addEventListener("click", function () {
      var panel = document.getElementById("notificationPanel");
      panel.hidden = !panel.hidden;
      this.setAttribute("aria-expanded", String(!panel.hidden));
    });
    document.getElementById("closeNotifications").addEventListener("click", function () {
      document.getElementById("notificationPanel").hidden = true;
      document.getElementById("notificationButton").setAttribute("aria-expanded", "false");
    });
    document.getElementById("backMap").addEventListener("click", function () {
      if (state.mapLevel === "service") openTerritory(state.territorySlug);
      else openWorld();
    });
    document.getElementById("mapSearch").addEventListener("change", runSearch);
    document.getElementById("mapSearch").addEventListener("keydown", function (event) {
      if (event.key === "Enter") { event.preventDefault(); runSearch(); }
    });
    var dialog = document.getElementById("helpDialog");
    document.getElementById("mapHelp").addEventListener("click", function () { dialog.showModal(); });
    document.getElementById("closeHelp").addEventListener("click", function () { dialog.close(); });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !dialog.open && state.mapLevel !== "world") {
        if (state.mapLevel === "service") openTerritory(state.territorySlug);
        else openWorld();
      }
      if (event.key === "/" && !event.ctrlKey && !event.metaKey && document.activeElement.tagName !== "INPUT") {
        event.preventDefault();
        document.getElementById("mapSearch").focus();
      }
    });
  }

  function loadOptional(path, fallback) {
    return api(path).catch(function () { return fallback; });
  }

  function bootAuthenticated(session) {
    state.session = session;
    return api("/api/v1/board/summary").then(function (summary) {
      state.summary = summary;
      return api("/api/v1/board/me");
    }).then(function (me) {
      state.me = me;
      return loadOptional("/api/v1/me/referrals?pageSize=50", { items: [] });
    }).then(function (referrals) {
      state.referrals = referrals.items || [];
      return loadOptional("/api/v1/me/achievements", { ruleApproved: false, items: [], notice: "Conquistas temporariamente indisponiveis." });
    }).then(function (achievements) {
      state.achievements = achievements;
      return loadOptional("/api/v1/me/notifications", { items: [] });
    }).then(function (notifications) {
      state.notifications = notifications.items || [];
      showApp();
      renderSession();
      renderGlobalState();
      renderSearchOptions();
      renderMap();
      renderRanking();
      renderAchievements();
      renderProfile();
      renderNotifications();
      bindControls();
    });
  }

  function boot() {
    api("/api/v1/auth/session").then(function (session) {
      if (!session.authenticated) {
        setLogin(session);
        return null;
      }
      return bootAuthenticated(session);
    }).catch(showFatal);
  }

  boot();
}());
