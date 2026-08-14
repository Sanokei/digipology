export const DICE_DASH_V2_LUA = `-- Dice Dash release builtin_dice_dash_2
-- The kernel commits die.roll before this callback observes the rolled value.
if callback == "on_roll" then
  return {
    {
      type = "die.roll",
      payload = { entityId = die_id }
    }
  }
end

if callback ~= "on_after_roll" or winner ~= 0 then
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
