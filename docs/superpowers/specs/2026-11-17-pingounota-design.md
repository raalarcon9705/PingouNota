# PingouNota — especificación de diseño del MVP

**Fecha:** 2026-11-17  
**Estado:** diseño y especificación aprobados por el usuario
**Nombre:** PingouNota  
**Repositorio objetivo:** `raalarcon9705/PingouNota` (público)  
**Licencia:** MIT

## 1. Objetivo

PingouNota será una extensión de Chrome para ayudar a conciliar pagos de Asaas y Husky con declaraciones de servicio. Detectará pagos recibidos y pagos todavía en tránsito, mantendrá un registro local y ofrecerá dos acciones de declaración distintas: registrar manualmente que una nota ya fue emitida fuera de la extensión, o solicitar la emisión real de una NFSe mediante la API de Adaflow.

Toda la interfaz de usuario de la extensión estará en portugués brasileño (pt-BR). El producto debe ser muy fácil de aprender y usar: valores predeterminados útiles, lenguaje directo, formularios guiados y pocas decisiones por paso. Se aplicarán principios de claridad, jerarquía, accesibilidad y consistencia inspirados en Apple HIG, adaptados a una extensión de Chrome.

## 2. Alcance del MVP

Incluye:

- Detección en Asaas y Husky. Komwise queda fuera del MVP.
- Lectura automática de listas de pagos mientras el usuario navega por los portales con su sesión iniciada.
- Primer intento de importar todo el historial disponible mediante la paginación normal de la interfaz; fallback a los pagos visibles si recorrer el historial no es fiable.
- Seguimiento de pagos pendientes de llegada y pagos recibidos.
- Base de datos y configuración locales al perfil de Chrome. Sin backend propio ni sincronización entre dispositivos.
- Perfiles locales de tomadores, plantillas de servicios y registro de emisiones.
- Marcado local individual y por lote.
- Emisión real individual y por lote mediante Adaflow, con revisión previa y confirmación explícita.
- Exportación/importación JSON y borrado de datos desde Configurações.
- Repositorio público en GitHub bajo `raalarcon9705`, con licencia MIT.

Fuera del MVP: Komwise, sincronización entre dispositivos, servidor propio, consulta/listado de NFSe emitidas fuera de PingouNota y emisión automática sin confirmación de usuario.

## 3. Experiencia y flujo

### 3.1 Detección y apertura

Al reconocer una página compatible de Asaas o Husky, PingouNota leerá las listas de pagos y actualizará sus registros locales. El icono de la extensión indicará que está disponible. El usuario abrirá el panel lateral al pulsar el icono; Chrome requiere una acción del usuario para abrir una extensión en el side panel, por lo que no se intentará abrir automáticamente al navegar.

La primera carga mostrará el progreso del escaneo. El escaneo podrá pausarse o cancelarse. Si la paginación permite recorrer el historial sin enviar formularios ni modificar datos de la cuenta, se recorrerán las páginas y se restaurará la ubicación/filtro original al terminar. Si no se puede hacer de forma fiable o el usuario está interactuando con la página, se importará solo la lista visible y se informará que el resultado es parcial.

### 3.2 Panel lateral

El panel incluye:

- Resumen de pagos pendientes de llegada y pagos recibidos.
- Filtros por portal y estado.
- Lista de pagos con origen, cliente/pagador, fecha, importe y estado.
- Selección múltiple para los pagos recibidos que aún no tienen declaración registrada.
- Acciones distintas: **“Marcar como emitida”** y **“Emitir pela Adaflow”**.
- Acceso a plantillas, tomadores y Configurações.

Los estados y avisos serán textualmente inequívocos en pt-BR. Los controles interactivos tendrán etiquetas, foco visible y áreas adecuadas para teclado y ratón. La interfaz respetará contraste legible y movimiento reducido.

### 3.3 Estados del pago y de la declaración

El estado observado en el portal y el estado de declaración local son dimensiones diferentes.

**Estado normalizado del pago:**

- `aguardando_recebimento`: pago detectado pero aún no recibido.
- `recebido`: el portal indica claramente que el dinero llegó/disponible.
- `revertido_ou_cancelado`: el portal indica reversión, estorno o cancelación.
- `desconhecido`: etiqueta nueva, ambigua o no reconocida.

Solo `recebido` habilita declarar. Estados desconocidos nunca se tratarán como recibidos por inferencia. Si después de declarar aparece reversión o cancelación, el registro se señalará para revisión; no se cancelará una NFSe automáticamente.

**Estado de declaración:**

- `nao_declarado`
- `marcado_localmente`
- `emissao_solicitada`
- `emitida_adaflow`
- `falha_adaflow`
- `cancelada_adaflow`

Marcar localmente solo actualiza PingouNota. Antes de confirmar se mostrará: **“Esta ação atualiza apenas o registro local da extensão. Ela não emite uma NFSe nem consulta notas emitidas na Adaflow.”** La acción guardará fecha y hora y no realizará llamadas a Adaflow.

## 4. Detección y conciliación

Los adaptadores de Asaas y Husky leerán únicamente los datos de pago que la interfaz presenta al usuario. Cada registro se deduplicará por combinación de portal e identificador estable del pago. Si un identificador no está disponible, el adaptador usará una clave compuesta documentada y marcará la coincidencia como menos fiable; no fusionará pagos ambiguos automáticamente.

Una actualización puede corregir importe, nombre, fecha o estado observado, pero nunca borrará el historial de declaración ni el resultado de una emisión. El adaptador guardará el rótulo/estado original recibido del portal junto al estado normalizado. Si el portal cambia su estructura o no se pueden leer campos esenciales, se informará el problema y no se inventarán valores.

En Asaas, el estado de pago confirmado todavía puede significar que el saldo no está disponible; solo el estado recibido/disponible será elegible. En Husky, la transferencia en camino se mantiene pendiente y solo se habilita declarar cuando la interfaz indique que llegó. El mapeo se limitará a estados que el adaptador reconozca sin ambigüedad.

## 5. Plantillas y perfiles de tomador

Una plantilla de servicio podrá guardar:

- CNAE.
- Descripción con variables de periodo, por ejemplo `{{mes}}` y `{{ano}}`.
- Preferencia de retención de impuestos.
- Correo de copia/reenvío.

El importe se tomará del pago y el tomador se seleccionará por separado. El usuario podrá completar los campos del tomador que falten y guardar el perfil localmente para reutilizarlo. Antes de enviar, se validarán los campos que exige Adaflow. Para crear un tomador brasileño nuevo, el API requiere dirección completa; para un tomador ya existente, Adaflow puede ignorar los demás datos enviados al resolverlo por documento.

Los perfiles guardados son locales y no se sincronizan. No se asumirá que la extensión puede consultar el catálogo de tomadores de Adaflow: el OpenAPI disponible no expone una ruta de listado de tomadores.

## 6. Emisión mediante Adaflow

La emisión real solo ocurre mediante la acción **“Emitir pela Adaflow”**. La revisión previa, individual o por lote, muestra al menos el tomador, documento, importe/moneda, CNAE, descripción, retención y correo de copia. Si falta un dato obligatorio o la moneda no está soportada, ese elemento no podrá enviarse hasta corregirlo.

La API usa `POST /nfses` con `Authorization: Bearer <token>` e `Idempotency-Key`. El token se configura en PingouNota y se guarda localmente. Cada solicitud tendrá una clave única persistida junto al payload para evitar duplicados tras interrupciones. El campo `nfse.external_id` incluirá el portal, el ID del pago y el ID de la operación de emisión; así cada intento explícito queda asociado al pago sin colisionar con una emisión anterior. La API documenta un máximo de cinco solicitudes por minuto por token; un lote se enviará secuencialmente, sin concurrencia, con margen de tiempo para respetar el límite.

La respuesta `202 requested` significa que la emisión fue aceptada, no que la nota ya fue emitida. PingouNota guardará el ID devuelto y consultará `GET /nfses/{id}` hasta obtener un estado terminal. Si una nota sigue `requested` por más de 15 minutos, la interfaz indicará que requiere seguimiento y no la reemitirá automáticamente con una clave nueva. Los errores accionables se mostrarán junto al campo o pago correspondiente. Las operaciones exitosas no se repetirán al reintentar otros elementos del lote.

La API no incluye una ruta para listar todas las NFSe emitidas. Por tanto, PingouNota conoce las notas que emitió por su propia integración y las que el usuario marcó localmente; no puede comprobar notas emitidas por otro sistema o directamente en Adaflow. El marcado local no cambia ningún estado en Adaflow.

Para pagos en moneda extranjera se usarán `foreign_value_cents` y `foreign_value_currency` solo si la moneda está en las aceptadas por Adaflow (USD, EUR, GBP, CAD, AUD). Los valores BRL se enviarán en centavos mediante `value_cents`.

## 7. Datos, privacidad y permisos

La base estructurada residirá en IndexedDB de la extensión. El token y preferencias pequeñas residirán en almacenamiento local de Chrome. No habrá servicio remoto de PingouNota. Los scripts de contenido enviarán los datos de pago extraídos al service worker; no escribirán en la base de la extensión ni harán llamadas a Adaflow. El token nunca se insertará en el contexto JavaScript de Asaas/Husky ni se expondrá al contenido de la página. El acceso a `chrome.storage.local` se limitará a contextos confiables de la extensión. Los permisos de host se limitarán a los dominios necesarios de los dos portales y a `app.adaflow.com` para las llamadas de emisión/consulta.

Los respaldos JSON incluirán pagos, estados, perfiles, plantillas y preferencias exportables; el token de Adaflow se excluirá por defecto del archivo. Importar mostrará una vista previa, evitará duplicados por claves estables y pedirá confirmación antes de reemplazar registros. La opción de borrar datos explicará el alcance y pedirá confirmación.

El repositorio nunca contendrá tokens, archivos de respaldo, datos reales de clientes, perfiles de navegador ni respuestas de producción. El `.gitignore` cubrirá secretos locales, salidas de build y datos de prueba sensibles.

## 8. Modelo de datos lógico

- **Payment:** proveedor, ID externo, datos visibles del pagador, fecha, importe en unidad menor, moneda, estado original del portal, estado normalizado, última observación, estado de declaración y fuente/fecha de cualquier acción manual.
- **TakerProfile:** nombre, CPF/CNPJ o identificador externo, email y dirección requeridos por Adaflow, más fechas de creación/actualización locales.
- **ServiceTemplate:** nombre de servicio, CNAE, plantilla de descripción, retenciones y correo de copia.
- **NfseOperation:** pago asociado, payload congelado, clave de idempotencia, ID de NFSe Adaflow, estado remoto, errores y fechas de solicitud/actualización.
- **Settings:** token Adaflow, preferencias de lectura y versión de esquema de respaldo. El token se excluye de exportaciones.

Los importes se almacenarán como enteros en centavos; no se usarán números de punto flotante para cálculos monetarios.

## 9. Errores y estados de recuperación

- Lista no reconocida: avisar que no se pudo leer y conservar registros previos.
- Historial/paginación inaccesible: importar lo visible e identificar el escaneo como parcial.
- Estado de pago ambiguo: `desconhecido`, sin permitir declaración.
- Datos incompletos de tomador o plantilla: mantener como borrador, indicar campos faltantes y no llamar a Adaflow.
- Error de validación de Adaflow: conservar el error por elemento y permitir corregir antes de un nuevo intento seguro.
- Respuesta `429`: pausar la cola y respetar el tiempo de espera indicado o un backoff conservador antes de continuar; no repetir rápidamente el lote.
- Timeout o respuesta incierta de una emisión: consultar/reconciliar usando la misma clave/recurso antes de cualquier nueva solicitud; nunca generar automáticamente una clave nueva para la misma operación incierta.
- Estado `requested` por más de 15 minutos: avisar y detener reintentos automáticos.
- Importación JSON inválida: no aplicar parcialmente; mostrar el error y dejar intacta la base existente.

## 10. Repositorio open source

El proyecto remoto se creará como repositorio **público** `raalarcon9705/PingouNota` bajo la licencia **MIT**. El repositorio incluirá como mínimo `LICENSE`, `README.md`, `.gitignore` y documentación del desarrollo. El README explicará el propósito, limitaciones, instalación de desarrollo, configuración del token de Adaflow y tratamiento local de datos. Las instrucciones dejarán claro que el marcado local no emite una NFSe.

La rama principal será `main`. Los cambios de configuración no incluirán secretos. Una vez que exista código, los cambios deberán verificarse antes de integrarse a `main`; cuando haya checks automatizados, la protección de `main` deberá exigir que pasen antes de integrar cambios. La automatización de CI se definirá en el plan de implementación. La creación del repo remoto y su publicación ocurren después de la revisión de esta especificación.

## 11. Verificación y criterios de aceptación

La implementación deberá cubrir con pruebas aisladas:

- Parseo de fixtures representativos de listas Asaas y Husky, incluidos cambios de estado y campos ausentes.
- Normalización de pagos y deduplicación por proveedor/ID.
- Transiciones entre pendiente, recibido, reversión y estados de declaración sin perder historial.
- Reglas de elegibilidad: solo pagos recibidos admiten marcado o emisión.
- Formato de payload Adaflow, centavos, monedas, campos obligatorios y clave de idempotencia.
- Cola de emisión que respeta el límite de solicitudes y no duplica operaciones inciertas.
- Exportación/importación, exclusión del token, duplicados y datos inválidos.

La revisión manual en Chrome deberá confirmar que el panel lateral, el indicador de disponibilidad, el escaneo parcial/completo, los dos flujos de declaración y todos los mensajes están en pt-BR y funcionan en páginas autenticadas de ambos portales. Las pruebas usarán datos sintéticos o enmascarados, nunca datos reales de clientes.
