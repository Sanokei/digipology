export const DICE_DASH_V3_LUA = `-- Dice Dash v3: real creator-runtime callbacks, scoring and turns.
local function announce_turn()
  local current = turns:current()
  if current ~= nil then refs.status:set(current.name .. " — roll to race to " .. settings.targetScore) end
end

function on_start(ctx)
  if props.role ~= "rules" then return end
  state.winner_id = nil
  for _, player in ipairs(players:list()) do scores:set(player, 0) end
  turns:start()
  announce_turn()
end

function on_player_join(ctx)
  if props.role ~= "rules" or state.winner_id ~= nil then return end
  scores:set(ctx.player, 0)
  local current = turns:current()
  turns:start(current)
  announce_turn()
end

function on_roll(ctx)
  if props.role ~= "die" then return end
  if state.winner_id ~= nil then error("The game is finished") end
  if ctx.player == nil or not turns:is_current(ctx.player) then error("Wait for your turn") end
  local previous = scores:get(ctx.player)
  local value = math.min(settings.targetScore, previous + ctx.value)
  scores:set(ctx.player, value)
  scene:get("score_" .. ctx.player.seat.id):set(value)
  if value >= settings.targetScore then
    state.winner_id = ctx.player.id
    turns:stop()
    refs.status:set(ctx.player.name .. " wins Dice Dash!")
  else
    turns:next()
    announce_turn()
  end
end

return {}
`;
