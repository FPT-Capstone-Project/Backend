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
    `SELECT ci.*, COALESCE(st.session_id, spawn_session.session_id) AS session_id,
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
    `SELECT ci.*, COALESCE(st.session_id, spawn_session.session_id) AS session_id,
            st.tray_id, st.session_tray_id, s.order_item_id, o.order_id, o.user_id AS customer_id,
            mt.name AS mushroom_name, reporter.full_name AS reported_by_name,
            (SELECT ec.expert_id FROM expert_consultations ec
             WHERE ec.issue_id = ci.issue_id
             ORDER BY ec.created_at DESC, ec.consultation_id DESC LIMIT 1) AS assigned_expert_id,
            spawn_inspection.stage AS spawn_stage
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

async function updateIssueStatus(issueId, status, expectedStatus) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE cultivation_issues
       SET status = $2,
           resolved_at = CASE WHEN $2 = 'RESOLVED' THEN now()
                              ELSE resolved_at END
       WHERE issue_id = $1 AND status = $3
       RETURNING *`,
      [issueId, status, expectedStatus],
    );
    if (!result.rows[0]) {
      throw new AppError('Issue status changed; reload before applying this transition', 409);
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

async function hasTreatmentResult(issueId) {
  const result = await pool.query(
    `SELECT 1
     FROM disease_treatment_logs dt
     INNER JOIN expert_consultations ec ON ec.consultation_id = dt.consultation_id
     WHERE ec.issue_id = $1 AND NULLIF(BTRIM(dt.result_description), '') IS NOT NULL
     LIMIT 1`,
    [issueId],
  );
  return Boolean(result.rows[0]);
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
    if (!['OPEN', 'IN_PROGRESS', 'MONITORING'].includes(issue.status)) {
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

async function createConsultationMessage(consultationId, message, senderId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const createdAt = new Date().toISOString();
    const messageSuffix = `\n\n[OPERATOR_FOLLOW_UP:${createdAt}]\n${message}`;
    const result = await client.query(
      `SELECT ec.consultation_id, ec.issue_id, ec.status, ec.expert_id,
              ci.title, ci.status AS issue_status
       FROM expert_consultations ec
       INNER JOIN cultivation_issues ci ON ci.issue_id = ec.issue_id
       WHERE ec.consultation_id = $1
       FOR UPDATE OF ec, ci`,
      [consultationId],
    );
    const consultation = result.rows[0];
    if (!consultation) throw new AppError('Consultation not found', 404);
    if (consultation.status !== 'PENDING' || consultation.expert_id === null) {
      throw new AppError('This consultation is not waiting for additional information', 409);
    }
    if (consultation.issue_status !== 'WAITING_EXPERT') {
      throw new AppError('Issue is not waiting for additional information', 409);
    }
    await client.query(
      `UPDATE expert_consultations
       SET question = question || $2, status = 'IN_PROGRESS'
       WHERE consultation_id = $1`,
      [consultationId, messageSuffix],
    );
    await client.query(
      `UPDATE cultivation_issues SET status = 'IN_PROGRESS' WHERE issue_id = $1`,
      [consultation.issue_id],
    );
    if (consultation.expert_id !== null) {
      await client.query(
        `INSERT INTO notifications (
           user_id, notification_type, title, message, created_by, reference_type, reference_id
         )
         VALUES ($1, 'MUSHROOM_DISEASE', 'Additional issue information provided',
                 $2, $3, 'EXPERT_CONSULTATION', $4)`,
        [
          consultation.expert_id,
          `The operator added information for issue "${consultation.title}".`,
          senderId,
          consultationId,
        ],
      );
    }
    await client.query('COMMIT');
    return {
      consultation_id: consultationId,
      sender_id: senderId,
      message,
      created_at: createdAt,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function findConsultationMessages(consultationId) {
  const result = await pool.query(
    `SELECT ec.question, ec.created_at, ci.reported_by, u.full_name AS sender_name
     FROM expert_consultations ec
     INNER JOIN cultivation_issues ci ON ci.issue_id = ec.issue_id
     INNER JOIN users u ON u.user_id = ci.reported_by
     WHERE ec.consultation_id = $1`,
    [consultationId],
  );
  const consultation = result.rows[0];
  if (!consultation) return [];

  const messages = [];
  const marker = /\n\n\[OPERATOR_FOLLOW_UP:([^\]]+)\]\n/g;
  let segmentStart = 0;
  let match;
  let messageId = 0;
  while ((match = marker.exec(consultation.question)) !== null) {
    const initialQuestion = consultation.question.slice(segmentStart, match.index).trim();
    if (initialQuestion && messageId === 0) {
      messages.push({
        message_id: messageId++,
        sender_id: consultation.reported_by,
        sender_name: consultation.sender_name,
        message: initialQuestion,
        created_at: consultation.created_at,
      });
    }
    const contentStart = marker.lastIndex;
    const nextMarker = marker.exec(consultation.question);
    const contentEnd = nextMarker ? nextMarker.index : consultation.question.length;
    messages.push({
      message_id: messageId++,
      sender_id: consultation.reported_by,
      sender_name: consultation.sender_name,
      message: consultation.question.slice(contentStart, contentEnd).trim(),
      created_at: match[1],
    });
    if (!nextMarker) break;
    segmentStart = nextMarker.index;
    marker.lastIndex = nextMarker.index;
  }
  if (messageId === 0 && consultation.question.trim()) {
    messages.push({
      message_id: 0,
      sender_id: consultation.reported_by,
      sender_name: consultation.sender_name,
      message: consultation.question.trim(),
      created_at: consultation.created_at,
    });
  }
  return messages;
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
  return { consultations: result.rows, total: Number(count.rows[0]?.total || 0) };
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
  return result.rows[0] || null;
}

async function assignConsultation(consultationId, expertId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const consultationResult = await client.query(
      `SELECT ec.consultation_id, ec.issue_id, ec.status, ec.expert_id,
              ci.status AS issue_status
       FROM expert_consultations ec
       INNER JOIN cultivation_issues ci ON ci.issue_id = ec.issue_id
       WHERE ec.consultation_id = $1 FOR UPDATE OF ec, ci`,
      [consultationId],
    );
    const consultation = consultationResult.rows[0];
    if (!consultation) throw new AppError('Consultation not found', 404);
    if (!['WAITING_EXPERT', 'IN_PROGRESS'].includes(consultation.issue_status)) {
      throw new AppError('Issue is not open for expert assignment', 409);
    }
    if (!['PENDING', 'IN_PROGRESS'].includes(consultation.status)) {
      throw new AppError('Consultation cannot be assigned in its current state', 409);
    }
    const result = await client.query(
      `UPDATE expert_consultations
       SET expert_id = $2, status = 'IN_PROGRESS'
       WHERE consultation_id = $1 RETURNING *`,
      [consultationId, expertId],
    );
    await client.query(
      `UPDATE cultivation_issues SET status = 'IN_PROGRESS' WHERE issue_id = $1`,
      [consultation.issue_id],
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

async function respondToConsultation(consultationId, response, actorId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT ec.consultation_id, ec.issue_id, ec.status, ec.expert_id,
              ci.reported_by, ci.title, ci.status AS issue_status
       FROM expert_consultations ec
       INNER JOIN cultivation_issues ci ON ci.issue_id = ec.issue_id
       WHERE ec.consultation_id = $1
       FOR UPDATE OF ec, ci`,
      [consultationId],
    );
    const consultation = result.rows[0];
    if (!consultation) throw new AppError('Consultation not found', 404);
    if (consultation.status !== 'IN_PROGRESS') {
      throw new AppError('Consultation is not open for a response', 409);
    }
    if (consultation.issue_status !== 'IN_PROGRESS') {
      throw new AppError('Issue is no longer open for expert diagnosis', 409);
    }
    const status = response.needsMoreInfo ? 'PENDING' : 'ANSWERED';
    const updated = await client.query(
      `UPDATE expert_consultations
       SET diagnosis = $2, solution = $3, status = $4, responded_at = now()
       WHERE consultation_id = $1 RETURNING *`,
      [consultationId, response.diagnosis, response.solution ?? null, status],
    );
    await client.query(
      `UPDATE cultivation_issues SET status = $2 WHERE issue_id = $1`,
      [consultation.issue_id, response.needsMoreInfo ? 'WAITING_EXPERT' : 'IN_PROGRESS'],
    );
    const notificationMessage = response.needsMoreInfo
      ? `Expert requests more information for issue "${consultation.title}".`
      : `Expert provided a diagnosis and treatment plan for issue "${consultation.title}".`;
    await client.query(
      `INSERT INTO notifications (
         user_id, notification_type, title, message, created_by, reference_type, reference_id
       )
       VALUES ($1, 'MUSHROOM_DISEASE', $2, $3, $4, 'CULTIVATION_ISSUE', $5)`,
      [
        consultation.reported_by,
        response.needsMoreInfo ? 'More information requested' : 'Expert diagnosis available',
        notificationMessage,
        actorId,
        consultation.issue_id,
      ],
    );
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function closeConsultation(consultationId) {
  const result = await pool.query(
    `UPDATE expert_consultations
     SET status = 'CLOSED'
     WHERE consultation_id = $1 AND status = 'ANSWERED'
     RETURNING *`,
    [consultationId],
  );
  if (!result.rows[0]) {
    const consultation = await findConsultation(consultationId);
    if (!consultation) throw new AppError('Consultation not found', 404);
    throw new AppError('Only a responded consultation can be closed', 409);
  }
  return result.rows[0];
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
    if (!['ANSWERED', 'CLOSED'].includes(consultation.consultation_status)
      || !consultation.solution
      || consultation.issue_status !== 'IN_PROGRESS') {
      throw new AppError('A provided expert solution is required before recording treatment', 409);
    }
    const treatment = await client.query(
      `INSERT INTO disease_treatment_logs (
         consultation_id, performed_by, action_description, result_description, performed_at
       )
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()))
       RETURNING *`,
      [
        consultationId,
        performedBy,
        data.actionDescription,
        data.resultDescription ?? null,
        data.performedAt ?? null,
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
            ), '[]'::json) AS media
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

async function createTreatmentMedia(treatmentLogId, media, uploadedBy, mediaStage, caption) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const status = await client.query(
      `SELECT ci.status
       FROM disease_treatment_logs dt
       INNER JOIN expert_consultations ec ON ec.consultation_id = dt.consultation_id
       INNER JOIN cultivation_issues ci ON ci.issue_id = ec.issue_id
       WHERE dt.treatment_log_id = $1 FOR UPDATE OF ci`,
      [treatmentLogId],
    );
    if (!status.rows[0]) throw new AppError('Treatment log not found', 404);
    if (['MONITORING', 'RESOLVED'].includes(status.rows[0].status)) {
      throw new AppError('Treatment media is locked in its current state', 409);
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
    `SELECT tm.*, dt.performed_by, ci.status AS issue_status
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
  const [issueMedia, consultationResult] = await Promise.all([
    findIssueMedia(issueId),
    pool.query(
      `SELECT ec.*, expert.full_name AS expert_name
       FROM expert_consultations ec
       LEFT JOIN users expert ON expert.user_id = ec.expert_id
       WHERE ec.issue_id = $1 ORDER BY ec.created_at, ec.consultation_id`,
      [issueId],
    ),
  ]);
  const consultations = await Promise.all(consultationResult.rows.map(async (consultation) => ({
    ...consultation,
    messages: await findConsultationMessages(consultation.consultation_id),
    treatments: await findTreatments(consultation.consultation_id),
  })));
  return { issue, media: issueMedia, consultations };
}

module.exports = {
  getRole,
  isExpertRole,
  createIssue,
  findIssues,
  findIssue,
  findIssueMedia,
  createIssueMedia,
  updateIssueStatus,
  hasTreatmentResult,
  createConsultation,
  createConsultationMessage,
  findConsultationMessages,
  findConsultations,
  findConsultation,
  assignConsultation,
  respondToConsultation,
  closeConsultation,
  createTreatment,
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
