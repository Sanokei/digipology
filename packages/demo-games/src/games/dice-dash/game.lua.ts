export const DICE_DASH_LUA = `-- Dice Dash release builtin_dice_dash_1
-- die is a kernel-v0 stub, so the host obtains roll_value from the top token
-- after a real deck.shuffle and asks this callback for registered actions.
if callback ~= "on_after_shuffle" or winner ~= 0 then
  return {}
end

local actions = {
  {
    type = "counter.add",
    payload = { entityId = score_id, amount = roll_value }
  }
}

if current_score + roll_value >= target_score then
  table.insert(actions, {
    type = "counter.set",
    payload = { entityId = winner_id, value = seat_number }
  })
end

return actions
`;
