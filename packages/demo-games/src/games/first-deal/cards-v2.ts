/** Authored identity for First Deal v2; never applied to the anonymous v1 release. */
export interface FirstDealV2Card {
  entityId: string;
  definitionId: string;
  rank: string;
  suit: string;
  label: string;
  color: string;
}

export const FIRST_DEAL_V2_CARDS_JSON = `{
  "formatVersion": 1,
  "deck": "standard-52",
  "mapping": "Clubs, Diamonds, Hearts, Spades; Ace through King in each suit. This mapping applies only to First Deal v2.",
  "cards": [
    {"entityId": "card_01", "definitionId": "standard_v2_clubs_a", "rank": "A", "suit": "clubs", "label": "Ace of Clubs", "color": "#ede7d6"},
    {"entityId": "card_02", "definitionId": "standard_v2_clubs_2", "rank": "2", "suit": "clubs", "label": "2 of Clubs", "color": "#ede7d6"},
    {"entityId": "card_03", "definitionId": "standard_v2_clubs_3", "rank": "3", "suit": "clubs", "label": "3 of Clubs", "color": "#ede7d6"},
    {"entityId": "card_04", "definitionId": "standard_v2_clubs_4", "rank": "4", "suit": "clubs", "label": "4 of Clubs", "color": "#ede7d6"},
    {"entityId": "card_05", "definitionId": "standard_v2_clubs_5", "rank": "5", "suit": "clubs", "label": "5 of Clubs", "color": "#ede7d6"},
    {"entityId": "card_06", "definitionId": "standard_v2_clubs_6", "rank": "6", "suit": "clubs", "label": "6 of Clubs", "color": "#ede7d6"},
    {"entityId": "card_07", "definitionId": "standard_v2_clubs_7", "rank": "7", "suit": "clubs", "label": "7 of Clubs", "color": "#ede7d6"},
    {"entityId": "card_08", "definitionId": "standard_v2_clubs_8", "rank": "8", "suit": "clubs", "label": "8 of Clubs", "color": "#ede7d6"},
    {"entityId": "card_09", "definitionId": "standard_v2_clubs_9", "rank": "9", "suit": "clubs", "label": "9 of Clubs", "color": "#ede7d6"},
    {"entityId": "card_10", "definitionId": "standard_v2_clubs_10", "rank": "10", "suit": "clubs", "label": "10 of Clubs", "color": "#ede7d6"},
    {"entityId": "card_11", "definitionId": "standard_v2_clubs_j", "rank": "J", "suit": "clubs", "label": "Jack of Clubs", "color": "#ede7d6"},
    {"entityId": "card_12", "definitionId": "standard_v2_clubs_q", "rank": "Q", "suit": "clubs", "label": "Queen of Clubs", "color": "#ede7d6"},
    {"entityId": "card_13", "definitionId": "standard_v2_clubs_k", "rank": "K", "suit": "clubs", "label": "King of Clubs", "color": "#ede7d6"},
    {"entityId": "card_14", "definitionId": "standard_v2_diamonds_a", "rank": "A", "suit": "diamonds", "label": "Ace of Diamonds", "color": "#f4dacf"},
    {"entityId": "card_15", "definitionId": "standard_v2_diamonds_2", "rank": "2", "suit": "diamonds", "label": "2 of Diamonds", "color": "#f4dacf"},
    {"entityId": "card_16", "definitionId": "standard_v2_diamonds_3", "rank": "3", "suit": "diamonds", "label": "3 of Diamonds", "color": "#f4dacf"},
    {"entityId": "card_17", "definitionId": "standard_v2_diamonds_4", "rank": "4", "suit": "diamonds", "label": "4 of Diamonds", "color": "#f4dacf"},
    {"entityId": "card_18", "definitionId": "standard_v2_diamonds_5", "rank": "5", "suit": "diamonds", "label": "5 of Diamonds", "color": "#f4dacf"},
    {"entityId": "card_19", "definitionId": "standard_v2_diamonds_6", "rank": "6", "suit": "diamonds", "label": "6 of Diamonds", "color": "#f4dacf"},
    {"entityId": "card_20", "definitionId": "standard_v2_diamonds_7", "rank": "7", "suit": "diamonds", "label": "7 of Diamonds", "color": "#f4dacf"},
    {"entityId": "card_21", "definitionId": "standard_v2_diamonds_8", "rank": "8", "suit": "diamonds", "label": "8 of Diamonds", "color": "#f4dacf"},
    {"entityId": "card_22", "definitionId": "standard_v2_diamonds_9", "rank": "9", "suit": "diamonds", "label": "9 of Diamonds", "color": "#f4dacf"},
    {"entityId": "card_23", "definitionId": "standard_v2_diamonds_10", "rank": "10", "suit": "diamonds", "label": "10 of Diamonds", "color": "#f4dacf"},
    {"entityId": "card_24", "definitionId": "standard_v2_diamonds_j", "rank": "J", "suit": "diamonds", "label": "Jack of Diamonds", "color": "#f4dacf"},
    {"entityId": "card_25", "definitionId": "standard_v2_diamonds_q", "rank": "Q", "suit": "diamonds", "label": "Queen of Diamonds", "color": "#f4dacf"},
    {"entityId": "card_26", "definitionId": "standard_v2_diamonds_k", "rank": "K", "suit": "diamonds", "label": "King of Diamonds", "color": "#f4dacf"},
    {"entityId": "card_27", "definitionId": "standard_v2_hearts_a", "rank": "A", "suit": "hearts", "label": "Ace of Hearts", "color": "#f4dacf"},
    {"entityId": "card_28", "definitionId": "standard_v2_hearts_2", "rank": "2", "suit": "hearts", "label": "2 of Hearts", "color": "#f4dacf"},
    {"entityId": "card_29", "definitionId": "standard_v2_hearts_3", "rank": "3", "suit": "hearts", "label": "3 of Hearts", "color": "#f4dacf"},
    {"entityId": "card_30", "definitionId": "standard_v2_hearts_4", "rank": "4", "suit": "hearts", "label": "4 of Hearts", "color": "#f4dacf"},
    {"entityId": "card_31", "definitionId": "standard_v2_hearts_5", "rank": "5", "suit": "hearts", "label": "5 of Hearts", "color": "#f4dacf"},
    {"entityId": "card_32", "definitionId": "standard_v2_hearts_6", "rank": "6", "suit": "hearts", "label": "6 of Hearts", "color": "#f4dacf"},
    {"entityId": "card_33", "definitionId": "standard_v2_hearts_7", "rank": "7", "suit": "hearts", "label": "7 of Hearts", "color": "#f4dacf"},
    {"entityId": "card_34", "definitionId": "standard_v2_hearts_8", "rank": "8", "suit": "hearts", "label": "8 of Hearts", "color": "#f4dacf"},
    {"entityId": "card_35", "definitionId": "standard_v2_hearts_9", "rank": "9", "suit": "hearts", "label": "9 of Hearts", "color": "#f4dacf"},
    {"entityId": "card_36", "definitionId": "standard_v2_hearts_10", "rank": "10", "suit": "hearts", "label": "10 of Hearts", "color": "#f4dacf"},
    {"entityId": "card_37", "definitionId": "standard_v2_hearts_j", "rank": "J", "suit": "hearts", "label": "Jack of Hearts", "color": "#f4dacf"},
    {"entityId": "card_38", "definitionId": "standard_v2_hearts_q", "rank": "Q", "suit": "hearts", "label": "Queen of Hearts", "color": "#f4dacf"},
    {"entityId": "card_39", "definitionId": "standard_v2_hearts_k", "rank": "K", "suit": "hearts", "label": "King of Hearts", "color": "#f4dacf"},
    {"entityId": "card_40", "definitionId": "standard_v2_spades_a", "rank": "A", "suit": "spades", "label": "Ace of Spades", "color": "#ede7d6"},
    {"entityId": "card_41", "definitionId": "standard_v2_spades_2", "rank": "2", "suit": "spades", "label": "2 of Spades", "color": "#ede7d6"},
    {"entityId": "card_42", "definitionId": "standard_v2_spades_3", "rank": "3", "suit": "spades", "label": "3 of Spades", "color": "#ede7d6"},
    {"entityId": "card_43", "definitionId": "standard_v2_spades_4", "rank": "4", "suit": "spades", "label": "4 of Spades", "color": "#ede7d6"},
    {"entityId": "card_44", "definitionId": "standard_v2_spades_5", "rank": "5", "suit": "spades", "label": "5 of Spades", "color": "#ede7d6"},
    {"entityId": "card_45", "definitionId": "standard_v2_spades_6", "rank": "6", "suit": "spades", "label": "6 of Spades", "color": "#ede7d6"},
    {"entityId": "card_46", "definitionId": "standard_v2_spades_7", "rank": "7", "suit": "spades", "label": "7 of Spades", "color": "#ede7d6"},
    {"entityId": "card_47", "definitionId": "standard_v2_spades_8", "rank": "8", "suit": "spades", "label": "8 of Spades", "color": "#ede7d6"},
    {"entityId": "card_48", "definitionId": "standard_v2_spades_9", "rank": "9", "suit": "spades", "label": "9 of Spades", "color": "#ede7d6"},
    {"entityId": "card_49", "definitionId": "standard_v2_spades_10", "rank": "10", "suit": "spades", "label": "10 of Spades", "color": "#ede7d6"},
    {"entityId": "card_50", "definitionId": "standard_v2_spades_j", "rank": "J", "suit": "spades", "label": "Jack of Spades", "color": "#ede7d6"},
    {"entityId": "card_51", "definitionId": "standard_v2_spades_q", "rank": "Q", "suit": "spades", "label": "Queen of Spades", "color": "#ede7d6"},
    {"entityId": "card_52", "definitionId": "standard_v2_spades_k", "rank": "K", "suit": "spades", "label": "King of Spades", "color": "#ede7d6"}
  ]
}`;

const authored = JSON.parse(FIRST_DEAL_V2_CARDS_JSON) as { cards: FirstDealV2Card[] };

/** The release's presentation metadata is derived from its hashed authored file. */
export const FIRST_DEAL_V2_DEFINITIONS = Object.freeze(Object.fromEntries(
  authored.cards.map((card) => [card.definitionId, Object.freeze({ label: card.label, color: card.color })]),
));
