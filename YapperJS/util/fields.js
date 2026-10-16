'use strict';
// profiles has column-level grants: select=* also requests private columns and
// is rejected. Request only the public fields represented by User/ClientUser.
const profileFields = 'id,username,display_name,bio,avatar_path,banner_path,custom_status,pronouns,accent_color,accent_color2';
module.exports = { profileFields };
