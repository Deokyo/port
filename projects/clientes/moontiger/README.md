# Leituras de tarot (cliente)

**Status:** Protótipo para cliente, não publicado  
**Stack:** HTML5, CSS3, JavaScript vanilla (Web Animations e Web Audio), sem backend  
**Fonte:** projeto de cliente, mantido fora deste repositório  
**Cliente:** autorizou a apresentação deste case  

## Contexto e desafio

A cliente atende por leituras de tarot e baralho cigano. Precisava de um site que explicasse o trabalho com clareza, sem prometer resultados, e que levasse cada pessoa ao WhatsApp já com o pacote escolhido.

## Objetivo da página

Apresentar as leituras, vender pacotes fechados e transformar a curiosidade da carta sorteada em pedido de leitura.

## Minha contribuição

- Estrutura da página e copy em primeira pessoa, com a aprovação de textos pendente da cliente
- Paywall por pacote: a carta mostra só uma frase, e a leitura completa fica nos pacotes
- Ancoragem de preço, com o pacote de 1 hora em destaque e preço por unidade
- Sorteio de 22 arcanos desenhados em SVG, sem repetir até o baralho acabar
- Um efeito visual e um som por arcano, sintetizados no navegador
- Suíte de 49 checagens automatizadas (layout, acessibilidade, mensagens do WhatsApp, movimento reduzido, desempenho)

## Principais decisões de UI/UX

- Pacotes com o de 1 hora primeiro e destacado, com o valor por minuto
- Cada botão de pacote abre o WhatsApp com a mensagem do pacote
- Som desligado por padrão, com botão no cabeçalho
- Movimento reduzido mostra a carta direto, sem animação
- Rodapé com ícones e aviso de que a leitura não substitui orientação profissional

## Pontos técnicos

- Um arquivo HTML, com CSS e JavaScript embutidos
- Animações só com transform e opacity
- Sem tracking, sem cookies e sem chamadas a serviços externos
- `noindex` enquanto for protótipo

## Prévia e código

- [Abrir a cópia sanitizada](demo/index.html)

## Observação

A cópia pública remove os links de WhatsApp e Instagram e não tem nenhum identificador de contato. Os preços, a descrição dos pacotes e as 22 frases das cartas ainda estão em revisão com a cliente.

Não há métricas de conversão ou impacto atribuídas a este case, porque o site não foi publicado.
