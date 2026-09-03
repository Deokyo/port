# ROG-e

**Status:** Produção  
**Stack:** HTML5, CSS3, JavaScript vanilla, responsive design e RD Station  
**Fonte:** `01_projects/production/rog-e/index.html`  
**Manifest:** verificado pelo SHA-256 `38efccf93d26182b82b2f50c369b39d600af11fa354e0b68a4bc30910c7c53a1`

## Contexto e desafio

A página combina uma narrativa setorial, troca de idioma e dois fluxos de formulário dentro das restrições do RD Station.

## Objetivo da LP

Ajudar empresas do setor a reconhecer desafios de backoffice e agendar uma avaliação com conteúdo em português ou inglês.

## Minha contribuição técnica

- Arquitetura da experiência bilíngue
- HTML, CSS e JavaScript vanilla com tradução no cliente
- Metadados dinâmicos por idioma na implementação atual
- Orquestração de formulários separados por idioma

## Principais decisões de UI/UX

- Hero técnico com gauge e diagnóstico
- Seletor PT/EN com estado acessível
- Fluxo visual entre desafios e áreas avaliadas
- Interface setorial sem abandonar as foundations da marca

## Pontos técnicos

- Dicionário de conteúdo PT/EN
- Sincronização de idioma e formulário
- Carregamento controlado da biblioteca RD com timeout
- Reveal e animação do gauge com fallback

## Prévia e código

- [Abrir a cópia sanitizada](demo/index.html)
- [Versão publicada](https://contato.locatelligroup.com.br/rog-e)

## Observação

A cópia pública mantém a troca de idioma e desativa os dois formulários e seus identificadores.

Não há métricas de conversão ou impacto atribuídas a este case sem evidência pública comparável.
