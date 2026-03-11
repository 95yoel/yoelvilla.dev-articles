# yoelvilla.dev-articles

Repositorio de contenido para el blog multiidioma de `yoelvilla.dev`.

Aquí se almacenan los artículos en Markdown y un script de Node.js que genera `index.json`, usado por el frontend para construir el listado de posts, metadatos y relaciones entre traducciones.

## Qué hace este repositorio

- Guarda los artículos en varios idiomas dentro de `articles/es` y `articles/en`.
- Genera un `index.json` común para que el frontend pueda leer títulos, resúmenes, fechas, tags, idiomas disponibles y slug canónico.
- Mantiene una relación estable entre traducciones aunque los nombres reales de archivo no coincidan exactamente entre idiomas.

## Estructura

```text
articles/
  es/
  en/
scripts/
  generate-index.mjs
index.json
```

## Cómo funciona el índice

El script `scripts/generate-index.mjs`:

- Lee todos los archivos Markdown de los idiomas soportados.
- Extrae frontmatter simple sin dependencias externas.
- Calcula un `slug` canónico compartido entre idiomas.
- Conserva el nombre real del archivo en `sourceSlug`.
- Obtiene el título desde la primera línea útil del contenido Markdown.
- Prioriza un `summary` manual en el frontmatter para el resumen del artículo.
- Puede generar un resumen automático desde el contenido como fallback.
- Usa `date` del frontmatter como fecha editorial preferente.
- Genera `index.json` ordenado por fecha descendente.

## Frontmatter recomendado

Cada artículo puede incluir un bloque al inicio como este:

```md
---
date: 2026-03-10
slug: mi-articulo
summary: Resumen corto del artículo
tags: [node, markdown, blog]
coverImage: /images/posts/mi-articulo.jpg
published: true
---
```

Campos relevantes:

- `date`: fecha editorial del artículo. Es la opción recomendada para evitar depender de fechas del runner de CI/CD.
- `slug`: base opcional para el slug canónico compartido entre idiomas.
- `summary`: resumen manual recomendado para el `index.json`.
- `tags`: lista de etiquetas.
- `coverImage`: imagen de portada.
- `published`: permite ocultar artículos si se establece en `false`.

## Resumen del artículo

Se recomienda definir `summary` manualmente en el frontmatter de cada artículo.

Esto simplifica la redacción de la descripción mostrada en el blog y evita depender de texto extraído automáticamente desde el cuerpo del Markdown.

La idea es que `summary` sea la fuente principal del resumen en `index.json`, dejando la generación automática como fallback cuando falte ese campo.

## Fecha de publicación

Si un artículo tiene `date` en el frontmatter, esa fecha se usa en el `index.json`.

Si no existe, el script intenta derivarla desde el filesystem del archivo. Eso puede ser suficiente en local, pero en CI/CD no siempre representa la fecha real de publicación. Por eso se recomienda definir `date` manualmente en cada artículo.

## Generación local

Para regenerar el índice manualmente:

```bash
node scripts/generate-index.mjs
```

El resultado se escribe en `index.json`.

## Notas

- El repositorio no es una API ni un backend clásico en runtime.
- Su función es servir como fuente de contenido y etapa de build para el blog estático.
- El objetivo principal es mantener un índice consistente y predecible para el frontend.
