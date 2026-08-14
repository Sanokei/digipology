export const FIRST_DEAL_LUA = `-- First Deal release builtin_first_deal_1
-- The merged Lua host injects only callback data. Return registered kernel
-- action descriptors for the host to order and apply atomically.
if callback ~= "on_start" then
  return {}
end

local actions = {
  { type = "deck.shuffle", payload = { deckId = deck_id } }
}

for _, player in ipairs(seated_players) do
  table.insert(actions, {
    type = "deck.draw_to_container",
    payload = { deckId = deck_id, target = player.handId, count = cards_per_player }
  })
end

return actions
`;
