# 🚨 Proyecto Archivado / No Mantenido 🚨

Este proyecto ha quedado obsoleto y ya no recibe actualizaciones. Actualmente utilizamos una solución mejorada que puedes encontrar aquí:

🔗 **[Ir al nuevo Analizador de Partidas de Ajedrez](https://github.com/victorigp/Analizador_partidas_ajedrez)**

<br><br>

![image](https://github.com/user-attachments/assets/df8b868e-04d3-4c45-b251-990304d52f56)

# Lichess Detailed Moves 2
Muestra jugadas brillantes, excelentes, buenas y de libro en los apartados de análisis y de estudio de Lichess sin necesidad de recargar la página. 
Al hacer clic sobre los textos de las jugadas, nos muestra su posición en el tablero con sus iconos correspondientes.

Modificación del script [Lichess - Detailed Moves](https://github.com/sealldeveloper/lichess-detailed-moves) by Seall.DEV & Thomas Sihapnya

## 🚀 Novedades de la Versión 2.0 (Nuevo Motor de Evaluación)
En esta versión hemos reescrito por completo la lógica de detección de jugadas. Ya no se usan umbrales fijos de centipeones (que daban falsos positivos en posiciones con mucha o nula ventaja), sino un Sistema de Probabilidad de Victoria (Win%) mucho más inteligente y humano.

El nuevo script incorpora 10 sistemas de análisis heurístico para evaluar el verdadero mérito de una jugada:

- Evaluación No Lineal (Win%): Mide cuánto ha aumentado matemáticamente tu probabilidad de ganar, en lugar del valor puro de las piezas.
- Consciencia de Fase de Partida: Los umbrales se adaptan dinámicamente. Es más estricto conseguir una jugada "Buena" en la apertura (donde la teoría dicta el camino) que en el medio juego o el final.
- Detección de Swing: Otorga bonus a las jugadas que logran "darle la vuelta a la tortilla" (cruzar el umbral de equilibrio o pasar de perder a ganar).
- Penalización de Jugadas Forzadas: Evita etiquetar como "Brillante" recapturas obvias o los únicos movimientos legales para escapar de un jaque.
- Prevención de Inflación: Limita el número de genialidades por partida para que las jugadas Brillantes sigan sintiéndose especiales y no se regalen.
- Topes de Probabilidad (Caps): Si tu posición ya era ganadora (+6.0) o totalmente perdedora, el script entiende que la partida está decidida y deja de repartir galardones por jugadas irrelevantes.
- Smoothing (Suavizado): Ignora picos falsos del motor del navegador para evitar clasificar mal una jugada por culpa de una evaluación a baja profundidad.
- Manejo inteligente de Jaque Mate: Mantiene la coherencia evaluando los Mates forzados.
- Filtro de Variaciones: Analiza estrictamente la línea principal, ignorando el ruido de las variantes de estudio.
- Lectura de DOM Híbrida: Sistema de respaldo (fallback) resistente a la forma en que Lichess esconde u organiza el código de las evaluaciones en los Estudios.

## 📊 Nuevos Umbrales Base (Basados en Delta de Win%)
Las jugadas se miden por cuánto mejoran tu probabilidad de victoria:

- Buenas: Mejora de ≥1.5%
- Excelentes: Mejora de ≥5.0%
- Brillantes: Mejora de ≥10.0%
(Estos umbrales se multiplican internamente por modificadores de fase, sacrificios y jugadas forzadas).

## ⚙️ Instalación
Importar el archivo Lichess - Detailed Moves 2.user.js en la extensión TamperMonkey (u otro gestor de userscripts) de tu navegador.
