const pool = require('../config/db');
const AppError = require('../utils/app-error');

async function getRole(userId) {
  const result = await pool.query(
    `SELECT r.role_name
     FROM users u
     INNER JOIN roles r ON r.role_id = u.role_id
     WHERE u.user_id = $1 AND u.status = 'ACTIVE'`,
    [userId],
  );
  return result.rows[0]?.role_name || null;
}

function isExpertRole(roleName) {
  return typeof roleName === 'string'
    && roleName.toLowerCase().replace(/[\s_-]/g, '').includes('expert');
}

async function createIssue(data, reportedBy) {
  if (data.spawnInspectionId === undefined && data.inspectionId === undefined) {
    throw new AppError('An inspection is required for a tray issue', 400);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let context;
    if (data.spawnInspectionId !== undefined) {
      const result = await client.query(
        `SELECT s.session_id, s.status, mt.name AS mushroom_name,
                COALESCE(progress.current_stage, s.status) AS reported_stage
         FROM spawn_inspections si
         INNER JOIN cultivation_sessions s ON s.session_id = si.session_id
         INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
         INNER JOIN orders o ON o.order_id = oi.order_id
         INNER JOIN mushroom_types mt ON mt.mushroom_type_id = s.mushroom_type_id
         LEFT JOIN LATERAL (
           SELECT current_stage
           FROM cultivation_progress cp
           WHERE cp.session_id = s.session_id
           ORDER BY cp.progress_id DESC
           LIMIT 1
         ) progress ON TRUE
         WHERE si.inspection_id = $1 AND o.payment_status = 'PAID'
         FOR UPDATE OF si, s`,
        [data.spawnInspectionId],
      );
      context = result.rows[0];
      if (!context) throw new AppError('Spawn inspection not found for a paid session', 404);
      if (!['SPAWN_RESTING', 'MYCELIAL_DEVELOPMENT'].includes(context.status)) {
        throw new AppError('Spawn issues can only be reported during spawn stages', 409);
      }

    } else {
      const result = await client.query(
        `SELECT s.session_id, s.status, mt.name AS mushroom_name,
                COALESCE(progress.current_stage, s.status) AS reported_stage,
                environment.snapshot AS environment_snapshot
         FROM cultivation_session_trays st
         INNER JOIN cultivation_sessions s ON s.session_id = st.session_id
         INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
         INNER JOIN orders o ON o.order_id = oi.order_id
         INNER JOIN mushroom_types mt ON mt.mushroom_type_id = s.mushroom_type_id
         LEFT JOIN LATERAL (
           SELECT current_stage
           FROM cultivation_progress cp
           WHERE cp.session_id = s.session_id
           ORDER BY cp.progress_id DESC
           LIMIT 1
         ) progress ON TRUE
         LEFT JOIN LATERAL (
           SELECT CASE WHEN COUNT(latest.sensor_address) = 0 THEN NULL
             ELSE jsonb_build_object(
               'capturedAt', now(),
               'floorId', cf.floor_id,
               'sensors', jsonb_agg(jsonb_build_object(
                 'sensorAddress', latest.sensor_address,
                 'temperature', latest.temperature,
                 'humidity', latest.humidity,
                 'isValid', latest.is_valid,
                 'receivedAt', latest.last_received_at
               ) ORDER BY latest.sensor_address)
             )
           END AS snapshot
           FROM cultivation_trays tray
           LEFT JOIN cultivation_floors cf ON cf.floor_id = tray.floor_id
           LEFT JOIN iot_sensor_latest latest
             ON latest.master_id = cf.master_id
             AND latest.node_address = cf.node_address
           WHERE tray.tray_id = st.tray_id
             AND latest.sensor_address IS NOT NULL
           GROUP BY cf.floor_id
         ) environment ON TRUE
         WHERE st.session_tray_id = $1 AND st.status = 'ACTIVE'
           AND o.payment_status = 'PAID'
         FOR UPDATE OF st, s`,
        [data.sessionTrayId],
      );
      context = result.rows[0];
      if (!context) throw new AppError('Active tray assignment not found for a paid session', 404);
      if (!['CULTIVATING', 'HARVEST_READY', 'HARVESTING'].includes(context.status)) {
        throw new AppError('Tray issues can only be reported during cultivation', 409);
      }
      if (data.inspectionId !== undefined) {
        const inspection = await client.query(
          `SELECT inspection_id
           FROM cultivation_inspections
           WHERE inspection_id = $1 AND session_tray_id = $2`,
          [data.inspectionId, data.sessionTrayId],
        );
        if (!inspection.rows[0]) {
          throw new AppError('Inspection does not belong to the selected tray', 400);
        }
      }
    }

    const result = await client.query(
      `INSERT INTO cultivation_issues (
         session_tray_id, inspection_id, spawn_inspection_id, reported_by,
         issue_type, title, description, severity
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        data.sessionTrayId ?? null,
        data.inspectionId ?? null,
        data.spawnInspectionId ?? null,
        reportedBy,
        data.issueType,
        data.title,
        data.description ?? null,
        data.severity ?? null,
      ],
    );
    await client.query('COMMIT');
    return {
      ...result.rows[0],
      session_id: context.session_id,
      mushroom_name: context.mushroom_name,
      reported_stage: context.reported_stage,
      environment_snapshot: context.environment_snapshot ?? null,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createIssueFromQr(data, reportedBy) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const trayResult = await client.query(
      `SELECT tray_id, tray_code
       FROM cultivation_trays
       WHERE qr_token = $1
       FOR UPDATE`,
      [data.qrToken],
    );
    const tray = trayResult.rows[0];
    if (!tray) throw new AppError('QR không hợp lệ.', 404, 'INVALID_QR_TOKEN');

    const assignmentResult = await client.query(
      `SELECT st.session_tray_id, s.session_id, s.status,
              mt.name AS mushroom_name,
              COALESCE(progress.current_stage, s.status) AS reported_stage,
              o.payment_status
       FROM cultivation_session_trays st
       INNER JOIN cultivation_sessions s ON s.session_id = st.session_id
       INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
       INNER JOIN orders o ON o.order_id = oi.order_id
       INNER JOIN mushroom_types mt ON mt.mushroom_type_id = s.mushroom_type_id
       LEFT JOIN LATERAL (
         SELECT current_stage
         FROM cultivation_progress cp
         WHERE cp.session_id = s.session_id
         ORDER BY cp.progress_id DESC
         LIMIT 1
       ) progress ON TRUE
       WHERE st.tray_id = $1 AND st.status = 'ACTIVE'
       FOR UPDATE OF st, s`,
      [tray.tray_id],
    );
    const context = assignmentResult.rows[0];
    if (!context) {
      throw new AppError('Tray does not have an active cultivation session assignment', 409, 'SESSION_TRAY_NOT_ACTIVE');
    }
    if (context.payment_status !== 'PAID') {
      throw new AppError('Issues can only be reported for paid sessions', 409);
    }
    if (!['CULTIVATING', 'HARVEST_READY', 'HARVESTING'].includes(context.status)) {
      throw new AppError('Tray issues can only be reported during cultivation', 409);
    }
    const inspectionResult = await client.query(
      `INSERT INTO cultivation_inspections (
         session_tray_id, inspected_by
       )
       VALUES ($1, $2)
       RETURNING *`,
      [context.session_tray_id, reportedBy],
    );
    const inspection = inspectionResult.rows[0];
    const imageResults = [];
    for (const imageUrl of data.imageUrls || []) {
      const image = await client.query(
        `INSERT INTO cultivation_inspection_images (inspection_id, image_url)
         VALUES ($1, $2)
         RETURNING *`,
        [inspection.inspection_id, imageUrl],
      );
      imageResults.push(image.rows[0]);
    }
    const result = await client.query(
      `INSERT INTO cultivation_issues (
         session_tray_id, inspection_id, spawn_inspection_id, reported_by,
         issue_type, title, description, severity
       )
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        context.session_tray_id,
        inspection.inspection_id,
        reportedBy,
        data.issueType,
        data.title,
        data.description,
        data.severity ?? null,
      ],
    );
    await client.query('COMMIT');
    return {
      ...result.rows[0],
      session_id: context.session_id,
      tray_id: tray.tray_id,
      tray_code: tray.tray_code,
      mushroom_name: context.mushroom_name,
      reported_stage: context.reported_stage,
      inspection,
      images: imageResults,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function findIssues({ status, severity, sessionId, limit, offset } = {}) {
  const values = [];
  const filters = [];
  const add = (column, value) => {
    if (value === undefined) return;
    values.push(value);
    filters.push(`${column} = $${values.length}`);
  };
  add('ci.status', status);
  add('ci.severity', severity);
  if (sessionId !== undefined) {
    values.push(sessionId);
    filters.push(`COALESCE(st.session_id, spawn_session.session_id) = $${values.length}`);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const count = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM cultivation_issues ci
     LEFT JOIN cultivation_session_trays st ON st.session_tray_id = ci.session_tray_id
     LEFT JOIN spawn_inspections si ON si.inspection_id = ci.spawn_inspection_id
     LEFT JOIN cultivation_sessions spawn_session ON spawn_session.session_id = si.session_id
     ${where}`,
    values,
  );
  const pageValues = [...values, limit, offset];
  const result = await pool.query(
    `SELECT ci.*,
            (SELECT ec.consultation_id FROM expert_consultations ec
             WHERE ec.issue_id = ci.issue_id
             ORDER BY ec.created_at DESC, ec.consultation_id DESC LIMIT 1) AS latest_consultation_id,
            COALESCE(st.session_id, spawn_session.session_id) AS session_id,
            st.tray_id, mt.name AS mushroom_name, reporter.full_name AS reported_by_name
     FROM cultivation_issues ci
     LEFT JOIN cultivation_session_trays st ON st.session_tray_id = ci.session_tray_id
     LEFT JOIN spawn_inspections si ON si.inspection_id = ci.spawn_inspection_id
     LEFT JOIN cultivation_sessions spawn_session ON spawn_session.session_id = si.session_id
     LEFT JOIN cultivation_sessions s ON s.session_id = COALESCE(st.session_id, spawn_session.session_id)
     LEFT JOIN mushroom_types mt ON mt.mushroom_type_id = s.mushroom_type_id
     LEFT JOIN users reporter ON reporter.user_id = ci.reported_by
     ${where}
     ORDER BY ci.reported_at DESC, ci.issue_id DESC
     LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues,
  );
  return { issues: result.rows, total: Number(count.rows[0]?.total || 0) };
}

async function findIssue(issueId) {
  const result = await pool.query(
    `SELECT ci.*,
            (SELECT ec.consultation_id FROM expert_consultations ec
             WHERE ec.issue_id = ci.issue_id
             ORDER BY ec.created_at DESC, ec.consultation_id DESC LIMIT 1) AS latest_consultation_id,
            COALESCE(st.session_id, spawn_session.session_id) AS session_id,
            st.tray_id, st.session_tray_id, s.order_item_id, o.order_id, o.user_id AS customer_id,
            mt.name AS mushroom_name, reporter.full_name AS reported_by_name,
            (SELECT ec.expert_id FROM expert_consultations ec
             WHERE ec.issue_id = ci.issue_id
             ORDER BY ec.created_at DESC, ec.consultation_id DESC LIMIT 1) AS responding_expert_id,
            spawn_inspection.stage AS spawn_stage,
            s.status AS session_status, s.start_at AS session_start_at,
            s.harvest_date AS expected_harvest_date,
            progress.current_stage AS growth_stage, progress.progress_percent AS growth_progress,
            progress.condition AS growth_condition, progress.updated_at AS growth_updated_at,
            tray.tray_code, tray.floor_id,
            inspection.tray_condition, inspection.mushroom_condition,
            COALESCE(inspection.notes, spawn_inspection.notes) AS inspection_notes,
            COALESCE(inspection.inspection_date, spawn_inspection.inspected_at) AS inspection_at,
            spawn_inspection.condition AS spawn_condition
     FROM cultivation_issues ci
     LEFT JOIN cultivation_session_trays st ON st.session_tray_id = ci.session_tray_id
     LEFT JOIN spawn_inspections spawn_inspection
       ON spawn_inspection.inspection_id = ci.spawn_inspection_id
     LEFT JOIN cultivation_sessions spawn_session
       ON spawn_session.session_id = spawn_inspection.session_id
     LEFT JOIN cultivation_sessions s
       ON s.session_id = COALESCE(st.session_id, spawn_session.session_id)
     LEFT JOIN order_items oi ON oi.order_item_id = s.order_item_id
     LEFT JOIN orders o ON o.order_id = oi.order_id
     LEFT JOIN mushroom_types mt ON mt.mushroom_type_id = s.mushroom_type_id
     LEFT JOIN users reporter ON reporter.user_id = ci.reported_by
     LEFT JOIN cultivation_trays tray ON tray.tray_id = st.tray_id
     LEFT JOIN cultivation_inspections inspection ON inspection.inspection_id = ci.inspection_id
     LEFT JOIN LATERAL (
       SELECT current_stage, progress_percent, condition, updated_at
       FROM cultivation_progress cp WHERE cp.session_id = s.session_id
       ORDER BY cp.progress_id DESC LIMIT 1
     ) progress ON TRUE
     WHERE ci.issue_id = $1`,
    [issueId],
  );
  return result.rows[0] || null;
}

async function findIssueMedia(issueId) {
  const result = await pool.query(
    `SELECT evidence.media_id, evidence.issue_id, evidence.media_url,
            evidence.media_type, evidence.caption, evidence.uploaded_by,
            evidence.uploaded_at
     FROM (
       SELECT cii.image_id::bigint AS media_id, ci.issue_id, cii.image_url AS media_url,
              'IMAGE'::varchar AS media_type, cii.caption,
              NULL::integer AS uploaded_by, cii.uploaded_at
       FROM cultivation_issues ci
       INNER JOIN cultivation_inspections inspection
         ON inspection.inspection_id = ci.inspection_id
       INNER JOIN cultivation_inspection_images cii
         ON cii.inspection_id = inspection.inspection_id
       WHERE ci.issue_id = $1
       UNION ALL
       SELECT sii.image_id::bigint AS media_id, ci.issue_id, sii.image_url AS media_url,
              'IMAGE'::varchar AS media_type, sii.caption,
              NULL::integer AS uploaded_by, sii.created_at AS uploaded_at
       FROM cultivation_issues ci
       INNER JOIN spawn_inspections spawn_inspection
         ON spawn_inspection.inspection_id = ci.spawn_inspection_id
       INNER JOIN spawn_inspection_images sii
         ON sii.inspection_id = spawn_inspection.inspection_id
       WHERE ci.issue_id = $1
     ) evidence
     ORDER BY evidence.uploaded_at, evidence.media_id`,
    [issueId],
  );
  return result.rows;
}

async function createIssueMedia(issueId, media, uploadedBy, caption) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const issue = await client.query(
      `SELECT status, inspection_id, spawn_inspection_id
       FROM cultivation_issues WHERE issue_id = $1 FOR UPDATE`,
      [issueId],
    );
    if (!issue.rows[0]) throw new AppError('Issue not found', 404);
    if (['MONITORING', 'RESOLVED'].includes(issue.rows[0].status)) {
      throw new AppError('Issue evidence is locked in its current state', 409);
    }
    let result;
    if (issue.rows[0].spawn_inspection_id !== null) {
      result = await client.query(
        `INSERT INTO spawn_inspection_images (inspection_id, image_url, caption)
         VALUES ($1, $2, $3)
         RETURNING image_id AS media_id, $4::integer AS issue_id, image_url AS media_url,
                   'IMAGE'::varchar AS media_type, caption, $5::integer AS uploaded_by,
                   created_at AS uploaded_at`,
        [issue.rows[0].spawn_inspection_id, media.mediaUrl, caption ?? null, issueId, uploadedBy],
      );
    } else if (issue.rows[0].inspection_id !== null) {
      result = await client.query(
        `INSERT INTO cultivation_inspection_images (inspection_id, image_url, caption)
         VALUES ($1, $2, $3)
         RETURNING image_id AS media_id, $4::integer AS issue_id, image_url AS media_url,
                   'IMAGE'::varchar AS media_type, caption, $5::integer AS uploaded_by,
                   uploaded_at`,
        [issue.rows[0].inspection_id, media.mediaUrl, caption ?? null, issueId, uploadedBy],
      );
    } else {
      throw new AppError('Issue images require a linked inspection in the supplied database', 409);
    }
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createConsultation(issueId, question, createdBy) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const issueResult = await client.query(
      `SELECT issue_id, status FROM cultivation_issues WHERE issue_id = $1 FOR UPDATE`,
      [issueId],
    );
    const issue = issueResult.rows[0];
    if (!issue) throw new AppError('Issue not found', 404);
    if (issue.status !== 'OPEN') {
      throw new AppError('Issue is not ready for a new expert consultation', 409);
    }
    const consultationResult = await client.query(
      `SELECT consultation_id FROM expert_consultations
       WHERE issue_id = $1 AND status <> 'CLOSED'
       LIMIT 1 FOR UPDATE`,
      [issueId],
    );
    if (consultationResult.rows[0]) {
      throw new AppError('Issue already has an active consultation', 409);
    }
    const result = await client.query(
      `INSERT INTO expert_consultations (issue_id, question)
       VALUES ($1, $2) RETURNING *`,
      [issueId, question],
    );
    await client.query(
      `UPDATE cultivation_issues SET status = 'WAITING_EXPERT' WHERE issue_id = $1`,
      [issueId],
    );
    await client.query(
      `INSERT INTO notifications (
         user_id, notification_type, title, message, created_by, reference_type, reference_id
       )
       SELECT u.user_id, 'MUSHROOM_DISEASE', 'New mushroom diagnosis request',
              $1, $2, 'EXPERT_CONSULTATION', $3
       FROM users u
       INNER JOIN roles r ON r.role_id = u.role_id
       WHERE u.status = 'ACTIVE'
         AND (u.role_id = 1 OR lower(regexp_replace(r.role_name, '[ _-]', '', 'g')) LIKE '%expert%')
         AND u.user_id <> $2`,
      [`New expert consultation requested for issue ${issueId}.`, createdBy, result.rows[0].consultation_id],
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Reuse the existing TEXT question column; no schema migration is required.
const CHAT_PREFIX = 'MCMS_CHAT_V1:';
function readConversation(consultation) {
  const raw = consultation.question || '';
  if (raw.startsWith(CHAT_PREFIX)) {
    try {
      const data = JSON.parse(raw.slice(CHAT_PREFIX.length));
      if (typeof data.question === 'string' && Array.isArray(data.messages)) return data;
    } catch { /* Preserve legacy plain text if it is not a valid envelope. */ }
  }
  const messages = [];
  // Preserve the latest response from consultations created before chat support.
  if (consultation.diagnosis && consultation.expert_id != null) {
    messages.push({ message_id: 'previous-response', sender_id: consultation.expert_id,
      message: [consultation.diagnosis, consultation.solution].filter(Boolean).join('\n\n'),
      created_at: consultation.responded_at || consultation.created_at });
  }
  return { question: raw, messages };
}
function publicConsultation(consultation) {
  return consultation ? { ...consultation, question: readConversation(consultation).question } : null;
}
async function appendConversationMessage(client, consultation, message, senderId, mediaUrl) {
  const conversation = readConversation(consultation);
  const entry = { message_id: `chat-${conversation.messages.length + 1}`,
    consultation_id: consultation.consultation_id, sender_id: senderId,
    message: message || '', media_url: mediaUrl || null, created_at: new Date().toISOString() };
  conversation.messages.push(entry);
  await client.query('UPDATE expert_consultations SET question = $2 WHERE consultation_id = $1',
    [consultation.consultation_id, CHAT_PREFIX + JSON.stringify(conversation)]);
  return entry;
}

async function createConsultationMessage(consultationId, message, senderId, options = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT ec.*, ci.status AS issue_status, ci.reported_by
       FROM expert_consultations ec
       JOIN cultivation_issues ci ON ci.issue_id = ec.issue_id
       WHERE ec.consultation_id = $1 FOR UPDATE OF ec, ci`, [consultationId]);
    const consultation = result.rows[0];
    if (!consultation) throw new AppError('Consultation not found', 404);
    if (consultation.status === 'CLOSED' || consultation.issue_status === 'RESOLVED') {
      throw new AppError('Consultation is closed', 409);
    }
    if (options.isExpert && !options.isAdmin && Number(consultation.expert_id) !== Number(senderId)) {
      throw new AppError('Only the assigned expert can reply', 403);
    }
    const saved = await appendConversationMessage(client, consultation, message, senderId, options.mediaUrl);
    await client.query(
      `INSERT INTO notifications (user_id, notification_type, title, message, created_by, reference_type, reference_id)
       SELECT u.user_id, 'MUSHROOM_DISEASE', 'New consultation message', $1, $2, $5, $3
       FROM users u JOIN roles r ON r.role_id = u.role_id
       WHERE u.status = 'ACTIVE' AND u.user_id <> $2 AND (
         u.user_id = $4 OR ($4::integer IS NULL AND (u.role_id = 1 OR lower(regexp_replace(r.role_name, '[ _-]', '', 'g')) LIKE '%expert%'))
       )`,
      [message || 'New photo attached', senderId,
        options.isExpert ? consultation.issue_id : consultationId,
        options.isExpert ? consultation.reported_by : consultation.expert_id,
        options.isExpert ? 'CULTIVATION_ISSUE' : 'EXPERT_CONSULTATION']);
    await client.query('COMMIT');
    return saved;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function findConsultationMessages(consultationId) {
  const result = await pool.query(
    `SELECT ec.*, ci.reported_by, u.full_name AS sender_name
     FROM expert_consultations ec
     INNER JOIN cultivation_issues ci ON ci.issue_id = ec.issue_id
     INNER JOIN users u ON u.user_id = ci.reported_by
     WHERE ec.consultation_id = $1`,
    [consultationId],
  );
  const consultation = result.rows[0];
  if (!consultation) return [];

  const conversation = readConversation(consultation);
  const parts = conversation.question.split(/\n\n\[OPERATOR_FOLLOW_UP:([^\]]+)\]\n/);
  const messages = [{ message_id: 'legacy-0', sender_id: consultation.reported_by,
    sender_name: consultation.sender_name, message: parts[0].trim(), created_at: consultation.created_at }];
  for (let i = 1; i < parts.length; i += 2) {
    messages.push({ message_id: `legacy-${i}`, sender_id: consultation.reported_by,
      sender_name: consultation.sender_name, message: (parts[i + 1] || '').trim(), created_at: parts[i] });
  }
  const ids = [...new Set(conversation.messages.map((m) => m.sender_id))];
  const senders = ids.length ? await pool.query('SELECT user_id, full_name FROM users WHERE user_id = ANY($1::integer[])', [ids]) : { rows: [] };
  const names = new Map(senders.rows.map((u) => [String(u.user_id), u.full_name]));
  return [...messages, ...conversation.messages.map((m) => ({ ...m, sender_name: names.get(String(m.sender_id)) || '' }))]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

async function findConsultations({ status, limit, offset } = {}) {
  const values = [];
  const where = status === undefined ? '' : (values.push(status), `WHERE ec.status = $1`);
  const count = await pool.query(
    `SELECT COUNT(*)::int AS total FROM expert_consultations ec ${where}`,
    values,
  );
  const pageValues = [...values, limit, offset];
  const result = await pool.query(
    `SELECT ec.*, ci.title AS issue_title, ci.severity, ci.status AS issue_status,
            ci.issue_type, COALESCE(st.session_id, ssi.session_id) AS session_id,
            reporter.full_name AS reported_by_name, expert.full_name AS expert_name
     FROM expert_consultations ec
     INNER JOIN cultivation_issues ci ON ci.issue_id = ec.issue_id
     LEFT JOIN cultivation_session_trays st ON st.session_tray_id = ci.session_tray_id
     LEFT JOIN spawn_inspections spi ON spi.inspection_id = ci.spawn_inspection_id
     LEFT JOIN cultivation_sessions ssi ON ssi.session_id = spi.session_id
     LEFT JOIN users reporter ON reporter.user_id = ci.reported_by
     LEFT JOIN users expert ON expert.user_id = ec.expert_id
     ${where}
     ORDER BY ec.created_at DESC, ec.consultation_id DESC
     LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues,
  );
  return { consultations: result.rows.map(publicConsultation), total: Number(count.rows[0]?.total || 0) };
}

async function findConsultation(consultationId) {
  const result = await pool.query(
    `SELECT ec.*, ci.reported_by, ci.title AS issue_title, ci.status AS issue_status,
            ci.severity, COALESCE(st.session_id, ssi.session_id) AS session_id,
            o.user_id AS customer_id
     FROM expert_consultations ec
     INNER JOIN cultivation_issues ci ON ci.issue_id = ec.issue_id
     LEFT JOIN cultivation_session_trays st ON st.session_tray_id = ci.session_tray_id
     LEFT JOIN spawn_inspections spi ON spi.inspection_id = ci.spawn_inspection_id
     LEFT JOIN cultivation_sessions ssi ON ssi.session_id = spi.session_id
     LEFT JOIN cultivation_sessions s ON s.session_id = COALESCE(st.session_id, ssi.session_id)
     LEFT JOIN order_items oi ON oi.order_item_id = s.order_item_id
     LEFT JOIN orders o ON o.order_id = oi.order_id
     WHERE ec.consultation_id = $1`,
    [consultationId],
  );
  return publicConsultation(result.rows[0]);
}

async function assignConsultation(consultationId, expertId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT ec.consultation_id, ec.expert_id, ec.status,
              ci.issue_id, ci.status AS issue_status
       FROM expert_consultations ec
       INNER JOIN cultivation_issues ci ON ci.issue_id = ec.issue_id
       WHERE ec.consultation_id = $1
       FOR UPDATE OF ec, ci`,
      [consultationId],
    );
    const consultation = result.rows[0];
    if (!consultation) throw new AppError('Consultation not found', 404);
    if (consultation.status !== 'PENDING'
      || consultation.expert_id !== null
      || consultation.issue_status !== 'WAITING_EXPERT') {
      throw new AppError('Consultation is no longer available to accept', 409);
    }
    const assigned = await client.query(
      `UPDATE expert_consultations
       SET expert_id = $2, status = 'IN_PROGRESS'
       WHERE consultation_id = $1
       RETURNING *`,
      [consultationId, expertId],
    );
    await client.query(
      `INSERT INTO notifications (
         user_id, notification_type, title, message, created_by,
         reference_type, reference_id
       )
       SELECT ci.reported_by, 'MUSHROOM_DISEASE',
              'Expert accepted consultation',
              'Chuyên gia đã nhận yêu cầu tư vấn và đang xem xét.',
              $2, 'CULTIVATION_ISSUE', ci.issue_id
       FROM cultivation_issues ci
       WHERE ci.issue_id = $1`,
      [consultation.issue_id, expertId],
    );
    await client.query('COMMIT');
    return publicConsultation(assigned.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function respondToConsultation(consultationId, response, actorId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT ec.*,
              ec.expert_id, ci.reported_by, ci.title, ci.status AS issue_status
       FROM expert_consultations ec
       INNER JOIN cultivation_issues ci ON ci.issue_id = ec.issue_id
       WHERE ec.consultation_id = $1
       FOR UPDATE OF ec, ci`,
      [consultationId],
    );
    const consultation = result.rows[0];
    if (!consultation) throw new AppError('Consultation not found', 404);
    const canRespond = (consultation.status === 'PENDING'
      && consultation.expert_id === null
      && consultation.issue_status === 'WAITING_EXPERT')
      || (consultation.status === 'IN_PROGRESS'
        && consultation.expert_id !== null
        && consultation.issue_status === 'WAITING_EXPERT'
        && Number(consultation.expert_id) === Number(actorId));
    if (!canRespond) {
      throw new AppError('Consultation is not open for a response', 409);
    }
    if (!response.needsMoreInfo && !response.solution) {
      throw new AppError('solution is required when providing a treatment plan', 400);
    }
    await appendConversationMessage(client, consultation,
      [response.diagnosis, response.needsMoreInfo ? null : response.solution].filter(Boolean).join('\n\n'), actorId);
    const nextStatus = response.needsMoreInfo ? 'IN_PROGRESS' : 'ANSWERED';
    const updated = await client.query(
      `UPDATE expert_consultations
       SET diagnosis = $2, solution = $3, expert_id = $4,
           status = $5, responded_at = now()
       WHERE consultation_id = $1 RETURNING *`,
      [
        consultationId,
        response.diagnosis,
        response.needsMoreInfo ? null : response.solution,
        actorId,
        nextStatus,
      ],
    );
    await client.query(
      `UPDATE cultivation_issues
       SET status = $2
       WHERE issue_id = $1`,
      [
        consultation.issue_id,
        response.needsMoreInfo ? 'WAITING_EXPERT' : 'IN_PROGRESS',
      ],
    );
    const notificationTitle = response.needsMoreInfo
      ? 'More information requested'
      : 'Expert diagnosis available';
    const notificationMessage = response.needsMoreInfo
      ? response.diagnosis
      : `Expert provided a diagnosis and treatment plan for issue "${consultation.title}".`;
    await client.query(
      `INSERT INTO notifications (
         user_id, notification_type, title, message, created_by, reference_type, reference_id
       )
       VALUES ($1, 'MUSHROOM_DISEASE', $2, $3, $4, 'CULTIVATION_ISSUE', $5)`,
      [
        consultation.reported_by,
        notificationTitle,
        notificationMessage,
        actorId,
        consultation.issue_id,
      ],
    );
    await client.query('COMMIT');
    return publicConsultation(updated.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createTreatment(consultationId, data, performedBy) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT ec.consultation_id, ec.issue_id, ec.status AS consultation_status,
                ec.solution, ci.status AS issue_status
       FROM expert_consultations ec
       INNER JOIN cultivation_issues ci ON ci.issue_id = ec.issue_id
       WHERE ec.consultation_id = $1
       FOR UPDATE OF ec, ci`,
      [consultationId],
    );
    const consultation = result.rows[0];
    if (!consultation) throw new AppError('Consultation not found', 404);
    if (consultation.consultation_status !== 'ANSWERED'
      || !consultation.solution
      || !['IN_PROGRESS', 'MONITORING'].includes(consultation.issue_status)) {
      throw new AppError('A provided expert solution is required before recording treatment', 409);
    }
    const treatment = await client.query(
      `INSERT INTO disease_treatment_logs (
         consultation_id, performed_by, action_description, result_description
       )
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        consultationId,
        performedBy,
        data.actionDescription,
        data.resultDescription ?? null,
      ],
    );
    await client.query(
      `UPDATE cultivation_issues
       SET status = 'WAITING_REVIEW'
       WHERE issue_id = $1 AND status = $2`,
      [consultation.issue_id, consultation.issue_status],
    );
    await client.query(
      `INSERT INTO notifications (
         user_id, notification_type, title, message, created_by, reference_type, reference_id
       )
       SELECT u.user_id, 'MUSHROOM_DISEASE', 'Treatment update submitted',
              $1, $2, 'CULTIVATION_ISSUE', $3
       FROM users u
       INNER JOIN roles r ON r.role_id = u.role_id
       WHERE u.status = 'ACTIVE'
         AND (u.role_id = 1 OR lower(regexp_replace(r.role_name, '[ _-]', '', 'g')) LIKE '%expert%')
         AND u.user_id <> $2`,
      [
        `Farm operator submitted a treatment update for issue ${consultation.issue_id}.`,
        performedBy,
        consultation.issue_id,
      ],
    );
    await client.query('COMMIT');
    return treatment.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function findTreatments(consultationId) {
  const result = await pool.query(
    `SELECT dt.*, u.full_name AS performed_by_name,
            COALESCE((
              SELECT json_agg(json_build_object(
                'media_id', tm.media_id, 'media_url', tm.media_url,
                'media_type', tm.media_type, 'media_stage', tm.media_stage,
                'caption', tm.caption, 'uploaded_by', tm.uploaded_by,
                'uploaded_at', tm.uploaded_at
              ) ORDER BY tm.uploaded_at, tm.media_id)
              FROM treatment_media tm WHERE tm.treatment_log_id = dt.treatment_log_id
            ), '[]'::json) AS media,
            COALESCE((
              SELECT json_agg(json_build_object(
                'review_id', etr.review_id,
                'review_result', etr.review_result,
                'review_comment', etr.review_comment,
                'reviewed_by', etr.reviewed_by,
                'reviewed_by_name', reviewer.full_name,
                'created_at', etr.created_at
              ) ORDER BY etr.created_at, etr.review_id)
              FROM expert_treatment_reviews etr
              INNER JOIN users reviewer ON reviewer.user_id = etr.reviewed_by
              WHERE etr.treatment_log_id = dt.treatment_log_id
            ), '[]'::json) AS reviews
     FROM disease_treatment_logs dt
     INNER JOIN users u ON u.user_id = dt.performed_by
     WHERE dt.consultation_id = $1
     ORDER BY dt.performed_at, dt.treatment_log_id`,
    [consultationId],
  );
  return result.rows;
}

async function findTreatment(treatmentLogId) {
  const result = await pool.query(
    `SELECT dt.*, ec.issue_id, ci.status AS issue_status
     FROM disease_treatment_logs dt
     INNER JOIN expert_consultations ec ON ec.consultation_id = dt.consultation_id
     INNER JOIN cultivation_issues ci ON ci.issue_id = ec.issue_id
     WHERE dt.treatment_log_id = $1`,
    [treatmentLogId],
  );
  return result.rows[0] || null;
}

async function findIssueReviews(issueId) {
  const result = await pool.query(
    `SELECT tr.*, reviewer.full_name AS reviewed_by_name
     FROM expert_treatment_reviews tr
     INNER JOIN users reviewer ON reviewer.user_id = tr.reviewed_by
     WHERE tr.issue_id = $1
     ORDER BY tr.created_at, tr.review_id`,
    [issueId],
  );
  return result.rows;
}

async function reviewTreatment(treatmentLogId, review, reviewerId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT dt.treatment_log_id, ec.consultation_id, ec.status AS consultation_status,
              ec.issue_id, ci.status AS issue_status, ci.reported_by
       FROM disease_treatment_logs dt
       INNER JOIN expert_consultations ec ON ec.consultation_id = dt.consultation_id
       INNER JOIN cultivation_issues ci ON ci.issue_id = ec.issue_id
       WHERE dt.treatment_log_id = $1
       FOR UPDATE OF ec, ci`,
      [treatmentLogId],
    );
    const treatment = result.rows[0];
    if (!treatment) throw new AppError('Treatment log not found', 404);
    if (treatment.issue_status !== 'WAITING_REVIEW'
      || treatment.consultation_status !== 'ANSWERED') {
      throw new AppError('Treatment is not waiting for expert review', 409);
    }
    const latestResult = await client.query(
      `SELECT treatment_log_id
       FROM disease_treatment_logs
       WHERE consultation_id = $1
       ORDER BY treatment_log_id DESC
       LIMIT 1`,
      [treatment.consultation_id],
    );
    if (Number(latestResult.rows[0]?.treatment_log_id) !== treatmentLogId) {
      throw new AppError('Only the latest treatment update can be reviewed', 409);
    }
    const existingReview = await client.query(
      `SELECT 1 FROM expert_treatment_reviews WHERE treatment_log_id = $1 LIMIT 1`,
      [treatmentLogId],
    );
    if (existingReview.rows[0]) {
      throw new AppError('Treatment has already been reviewed', 409);
    }
    const created = await client.query(
      `INSERT INTO expert_treatment_reviews (
         issue_id, treatment_log_id, reviewed_by, review_result, review_comment
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [treatment.issue_id, treatmentLogId, reviewerId, review.result, review.comment ?? null],
    );
    const nextIssueStatus = review.result === 'APPROVED' ? 'MONITORING' : 'IN_PROGRESS';
    const issueUpdate = await client.query(
      `UPDATE cultivation_issues
       SET status = $2,
           resolved_at = NULL
       WHERE issue_id = $1 AND status = 'WAITING_REVIEW'
       RETURNING *`,
      [treatment.issue_id, nextIssueStatus],
    );
    if (!issueUpdate.rows[0]) {
      throw new AppError('Issue status changed; reload before reviewing this treatment', 409);
    }
    const approved = review.result === 'APPROVED';
    await client.query(
      `INSERT INTO notifications (
         user_id, notification_type, title, message, created_by, reference_type, reference_id
       )
       VALUES ($1, 'MUSHROOM_DISEASE', $2, $3, $4, 'CULTIVATION_ISSUE', $5)`,
      [
        treatment.reported_by,
        approved ? 'Treatment approved' : 'More treatment required',
        approved
          ? `Expert approved the treatment update; issue ${treatment.issue_id} remains under monitoring.`
          : `Expert requested additional treatment for issue ${treatment.issue_id}.`,
        reviewerId,
        treatment.issue_id,
      ],
    );
    await client.query('COMMIT');
    return { ...created.rows[0], issue_status: issueUpdate.rows[0].status };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function closeConsultation(consultationId, expertId, data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT ec.consultation_id, ec.issue_id, ec.expert_id, ec.status AS consultation_status,
              ci.status AS issue_status, ci.reported_by
       FROM expert_consultations ec
       INNER JOIN cultivation_issues ci ON ci.issue_id = ec.issue_id
       WHERE ec.consultation_id = $1
       FOR UPDATE OF ec, ci`,
      [consultationId],
    );
    const consultation = result.rows[0];
    if (!consultation) throw new AppError('Consultation not found', 404);
    if (consultation.issue_status === 'RESOLVED'
      || consultation.consultation_status === 'CLOSED') {
      throw new AppError('Consultation is already closed', 409);
    }
    if (consultation.expert_id !== null
      && Number(consultation.expert_id) !== Number(expertId)) {
      throw new AppError('Only the assigned expert can close this consultation', 403);
    }
    if (['WAITING_REVIEW', 'MONITORING'].includes(consultation.issue_status)) {
      throw new AppError('Use the issue resolution flow after treatment monitoring', 409);
    }
    if (consultation.consultation_status === 'ANSWERED') {
      throw new AppError('A treatment plan already exists; use the treatment monitoring flow', 409);
    }
    await appendConversationMessage(
      client,
      consultation,
      data.diagnosis,
      expertId,
    );
    const updatedConsultation = await client.query(
      `UPDATE expert_consultations
       SET diagnosis = $2, solution = NULL, expert_id = $3,
           status = 'CLOSED', responded_at = COALESCE(responded_at, now()), closed_at = now()
       WHERE consultation_id = $1
       RETURNING *`,
      [consultationId, data.diagnosis, expertId],
    );
    const updatedIssue = await client.query(
      `UPDATE cultivation_issues
       SET status = 'RESOLVED', resolved_at = now(), resolved_by = $2
       WHERE issue_id = $1 AND status NOT IN ('RESOLVED', 'WAITING_REVIEW')
       RETURNING *`,
      [consultation.issue_id, expertId],
    );
    if (!updatedIssue.rows[0]) {
      throw new AppError('Issue status changed; reload before closing the consultation', 409);
    }
    const completionReview = await client.query(
      `INSERT INTO expert_treatment_reviews (
         issue_id, treatment_log_id, reviewed_by, review_result, review_comment
       )
       VALUES ($1, NULL, $2, 'RESOLVED', $3)
       RETURNING *`,
      [consultation.issue_id, expertId, data.comment ?? null],
    );
    await client.query(
      `INSERT INTO notifications (
         user_id, notification_type, title, message, created_by, reference_type, reference_id
       )
       VALUES ($1, 'MUSHROOM_DISEASE', 'Issue resolved', $2, $3, 'CULTIVATION_ISSUE', $4)`,
      [
        consultation.reported_by,
        `Expert closed consultation ${consultationId} and resolved issue ${consultation.issue_id}.`,
        expertId,
        consultation.issue_id,
      ],
    );
    await client.query('COMMIT');
    return {
      ...publicConsultation(updatedConsultation.rows[0]),
      issue_status: updatedIssue.rows[0].status,
      issue_resolved_at: updatedIssue.rows[0].resolved_at,
      completion_review: completionReview.rows[0],
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function resolveIssue(issueId, reviewerId, comment) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const consultationIdResult = await client.query(
      `SELECT consultation_id
       FROM expert_consultations
       WHERE issue_id = $1
       ORDER BY created_at DESC, consultation_id DESC
       LIMIT 1`,
      [issueId],
    );
    const consultationId = consultationIdResult.rows[0]?.consultation_id;
    if (!consultationId) {
      const missingConsultationIssue = await client.query(
        `SELECT issue_id, status, reported_by
         FROM cultivation_issues
         WHERE issue_id = $1
         FOR UPDATE`,
        [issueId],
      );
      if (!missingConsultationIssue.rows[0]) throw new AppError('Issue not found', 404);
      throw new AppError('An answered consultation is required to resolve the issue', 409);
    }
    const consultationResult = await client.query(
      `SELECT consultation_id, status
       FROM expert_consultations
       WHERE consultation_id = $1
       FOR UPDATE`,
      [consultationId],
    );
    const consultation = consultationResult.rows[0];
    const issueResult = await client.query(
      `SELECT issue_id, status, reported_by
       FROM cultivation_issues
       WHERE issue_id = $1
       FOR UPDATE`,
      [issueId],
    );
    const issue = issueResult.rows[0];
    if (!issue) throw new AppError('Issue not found', 404);
    if (issue.status !== 'MONITORING') {
      throw new AppError('Only an issue under monitoring can be confirmed as resolved', 409);
    }
    if (!consultation || consultation.status !== 'ANSWERED') {
      throw new AppError('An answered consultation is required to resolve the issue', 409);
    }
    const treatmentResult = await client.query(
      `SELECT treatment_log_id
       FROM disease_treatment_logs
       WHERE consultation_id = $1
       ORDER BY treatment_log_id DESC
       LIMIT 1`,
      [consultation.consultation_id],
    );
    const completionReview = await client.query(
      `INSERT INTO expert_treatment_reviews (
         issue_id, treatment_log_id, reviewed_by, review_result, review_comment
       )
       VALUES ($1, $2, $3, 'RESOLVED', $4)
       RETURNING *`,
      [issueId, treatmentResult.rows[0]?.treatment_log_id ?? null, reviewerId, comment ?? null],
    );
    const updatedIssue = await client.query(
      `UPDATE cultivation_issues
       SET status = 'RESOLVED', resolved_at = now(), resolved_by = $2
       WHERE issue_id = $1 AND status = 'MONITORING'
       RETURNING *`,
      [issueId, reviewerId],
    );
    if (!updatedIssue.rows[0]) {
      throw new AppError('Issue status changed; reload before confirming resolution', 409);
    }
    const closedConsultation = await client.query(
      `UPDATE expert_consultations
       SET status = 'CLOSED', closed_at = now()
       WHERE consultation_id = $1 AND status = 'ANSWERED'
       RETURNING consultation_id, closed_at`,
      [consultation.consultation_id],
    );
    if (!closedConsultation.rows[0]) {
      throw new AppError('Consultation could not be closed after resolution', 409);
    }
    await client.query(
      `INSERT INTO notifications (
         user_id, notification_type, title, message, created_by, reference_type, reference_id
       )
       VALUES ($1, 'MUSHROOM_DISEASE', 'Issue resolved', $2, $3, 'CULTIVATION_ISSUE', $4)`,
      [
        issue.reported_by,
        `Expert confirmed issue ${issueId} is resolved.`,
        reviewerId,
        issueId,
      ],
    );
    await client.query('COMMIT');
    return {
      ...updatedIssue.rows[0],
      consultation_status: 'CLOSED',
      closed_at: closedConsultation.rows[0].closed_at,
      completion_review: completionReview.rows[0],
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createTreatmentMedia(treatmentLogId, media, uploadedBy, mediaStage, caption) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const status = await client.query(
      `SELECT ci.status, dt.consultation_id,
              (SELECT latest.treatment_log_id
               FROM disease_treatment_logs latest
               WHERE latest.consultation_id = dt.consultation_id
               ORDER BY latest.treatment_log_id DESC
               LIMIT 1) AS latest_treatment_log_id
       FROM disease_treatment_logs dt
       INNER JOIN expert_consultations ec ON ec.consultation_id = dt.consultation_id
       INNER JOIN cultivation_issues ci ON ci.issue_id = ec.issue_id
       WHERE dt.treatment_log_id = $1 FOR UPDATE OF ci`,
      [treatmentLogId],
    );
    if (!status.rows[0]) throw new AppError('Treatment log not found', 404);
    if (status.rows[0].status !== 'WAITING_REVIEW'
      || Number(status.rows[0].latest_treatment_log_id) !== treatmentLogId) {
      throw new AppError('Only the latest treatment awaiting review can be updated', 409);
    }
    const result = await client.query(
      `INSERT INTO treatment_media (
         treatment_log_id, media_url, media_type, media_stage, caption, uploaded_by
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING media_id, treatment_log_id, media_url, media_type,
                 media_stage, caption, uploaded_by, uploaded_at`,
      [
        treatmentLogId,
        media.mediaUrl,
        media.mediaType,
        mediaStage,
        caption ?? null,
        uploadedBy,
      ],
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function findTreatmentMedia(mediaId) {
  const result = await pool.query(
    `SELECT tm.*, dt.performed_by, ci.status AS issue_status,
            (SELECT latest.treatment_log_id
             FROM disease_treatment_logs latest
             WHERE latest.consultation_id = dt.consultation_id
             ORDER BY latest.treatment_log_id DESC
             LIMIT 1) AS latest_treatment_log_id
     FROM treatment_media tm
     INNER JOIN disease_treatment_logs dt ON dt.treatment_log_id = tm.treatment_log_id
     INNER JOIN expert_consultations ec ON ec.consultation_id = dt.consultation_id
     INNER JOIN cultivation_issues ci ON ci.issue_id = ec.issue_id
     WHERE tm.media_id = $1`,
    [mediaId],
  );
  return result.rows[0] || null;
}

async function deleteTreatmentMedia(mediaId) {
  const result = await pool.query(
    `DELETE FROM treatment_media WHERE media_id = $1 RETURNING *`,
    [mediaId],
  );
  return result.rows[0] || null;
}

async function findCustomerIssues(sessionId, userId) {
  const result = await pool.query(
    `SELECT ci.*, COALESCE(st.session_id, ssi.session_id) AS session_id,
            st.tray_id, mt.name AS mushroom_name
     FROM cultivation_issues ci
     LEFT JOIN cultivation_session_trays st ON st.session_tray_id = ci.session_tray_id
     LEFT JOIN spawn_inspections spi ON spi.inspection_id = ci.spawn_inspection_id
     LEFT JOIN cultivation_sessions ssi ON ssi.session_id = spi.session_id
     LEFT JOIN cultivation_sessions s ON s.session_id = COALESCE(st.session_id, ssi.session_id)
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     LEFT JOIN mushroom_types mt ON mt.mushroom_type_id = s.mushroom_type_id
     WHERE s.session_id = $1 AND ($2::integer IS NULL OR o.user_id = $2)
     ORDER BY ci.reported_at DESC, ci.issue_id DESC`,
    [sessionId, userId],
  );
  return result.rows;
}

async function customerOwnsSession(sessionId, userId) {
  const result = await pool.query(
    `SELECT 1
     FROM cultivation_sessions s
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     WHERE s.session_id = $1 AND o.user_id = $2
     LIMIT 1`,
    [sessionId, userId],
  );
  return Boolean(result.rows[0]);
}

async function findSessionIssuesForAdmin(sessionId) {
  return findCustomerIssues(sessionId, null);
}

async function findCustomerIssue(issueId, userId) {
  const issue = await findIssue(issueId);
  if (!issue || Number(issue.customer_id) !== Number(userId)) return null;
  return issue;
}

async function findIssueTimeline(issueId) {
  const issue = await findIssue(issueId);
  if (!issue) return null;
  const [issueMedia, reviews, consultationResult] = await Promise.all([
    findIssueMedia(issueId),
    findIssueReviews(issueId),
    pool.query(
      `SELECT ec.*, expert.full_name AS expert_name
       FROM expert_consultations ec
       LEFT JOIN users expert ON expert.user_id = ec.expert_id
       WHERE ec.issue_id = $1 ORDER BY ec.created_at, ec.consultation_id`,
      [issueId],
    ),
  ]);
  issue.reviews = reviews;
  const consultations = await Promise.all(consultationResult.rows.map(async (consultation) => ({
    ...publicConsultation(consultation),
    messages: await findConsultationMessages(consultation.consultation_id),
    treatments: await findTreatments(consultation.consultation_id),
  })));
  return { issue, media: issueMedia, reviews, consultations };
}

module.exports = {
  getRole,
  isExpertRole,
  createIssue,
  createIssueFromQr,
  findIssues,
  findIssue,
  findIssueReviews,
  findIssueMedia,
  createIssueMedia,
  createConsultation,
  createConsultationMessage,
  findConsultationMessages,
  findConsultations,
  findConsultation,
  assignConsultation,
  respondToConsultation,
  closeConsultation,
  createTreatment,
  reviewTreatment,
  resolveIssue,
  findTreatments,
  findTreatment,
  createTreatmentMedia,
  findTreatmentMedia,
  deleteTreatmentMedia,
  findCustomerIssues,
  findSessionIssuesForAdmin,
  customerOwnsSession,
  findCustomerIssue,
  findIssueTimeline,
};
