// Shared by order capacity checks and explicit tray assignment.
function approvedMushroomConfigWhere(alias, mushroomParameter) {
  return `${alias}.profile_approved = TRUE AND (
    (${alias}.config_source = 'FLOOR' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(${alias}.source_profiles) = 'array'
          THEN ${alias}.source_profiles ELSE '[]'::jsonb END
      ) AS profile
      WHERE profile->>'mushroom_type_id' = ${mushroomParameter}::text
    )) OR (${alias}.config_source = 'LEGACY' AND ${alias}.mushroom_type_id = ${mushroomParameter}::int)
  )`;
}

module.exports = { approvedMushroomConfigWhere };
