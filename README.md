# BANCO-MAM · Movimientos bancarios de Mary

App para ver y analizar los movimientos de la cuenta de Mary: gastos recurrentes, transferencias enviadas y recibidas, y control de líneas duplicadas.

- **La app** (este repo) se abre desde GitHub Pages. Aquí solo hay código: no hay nombres, CUIT ni movimientos.
- **Los datos** están en la hoja de Google *BANCO-MAM - Movimientos de Mary* (Drive de Oscar), que no es pública.
- **El puente** entre las dos es el Apps Script de esa hoja (`apps-script/Code.gs`).

## Quién puede hacer qué

| Clave | Puede |
|---|---|
| Clave de administrador (Oscar) | Ver todo, cargar resúmenes del banco, poner nombres y categorías, revisar duplicados |
| Clave de familia | Solo ver. No puede cambiar nada |

Las claves están al principio de `Code.gs`, que solo existe en el Apps Script de la hoja, no en este repo. Para cambiarlas: editá esas líneas y volvé a implementar con una nueva versión.

## Cómo se carga un resumen

1. En la web del banco: cuenta de Mary → Últimos movimientos → descargar Excel (`CompartirDetalleMovimiento-….xlsx`).
2. En la app, con la clave de administrador: **＋ Añadir resumen del banco** (o arrastrá el archivo).
3. Las líneas que ya estaban se descartan solas: se comparan por fecha, descripción, importes y saldo. Si entre un resumen y otro quedaron días sin cubrir, la app avisa.

## Instalar el Apps Script (una sola vez)

1. Abrí la hoja *BANCO-MAM - Movimientos de Mary* → **Extensiones → Apps Script**.
2. Borrá lo que haya y pegá todo `apps-script/Code.gs`. Guardá.
3. Arriba, elegí la función **probar** → **Ejecutar** → aceptá los permisos (es tu propia cuenta).
4. **Implementar → Nueva implementación** → tipo **Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
   → **Implementar** y copiá la URL que termina en `/exec`.
5. Esa URL va en `index.html`, en la línea `const API_URL = "…"`.

"Cualquier usuario" solo significa que la app puede hablar con el script. Sin una de las dos claves, el script no devuelve ningún dato.
