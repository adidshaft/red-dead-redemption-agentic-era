// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract ArenaEconomy {
    error AgentAlreadyRegistered();
    error AgentNotRegistered();
    error NotAgentOwner();
    error InvalidSkillId();
    error InsufficientPayment();
    error InvalidTreasury();
    error NotOperator();
    error MatchAlreadySettled();
    error NoEntryPool();
    error MatchLocked();
    error MatchNotLocked();
    error AlreadyEnteredMatch();
    error WinnerDidNotEnterMatch();

    uint256 public constant SKILL_BAND_ONE_PRICE = 0.001 ether;
    uint256 public constant SKILL_BAND_TWO_PRICE = 0.002 ether;
    uint256 public constant SKILL_BAND_THREE_PRICE = 0.004 ether;
    uint256 public constant MATCH_ENTRY_FEE = 0.002 ether;
    uint256 public constant WINNER_SHARE_BPS = 9500;
    uint256 public constant APP_SHARE_BPS = 500;

    struct AgentAccount {
        address owner;
        address treasury;
        bool exists;
    }

    mapping(bytes32 => AgentAccount) public agents;
    mapping(bytes32 => uint256[5]) private skillPurchaseCounts;
    mapping(bytes32 => bool) public settledMatches;
    mapping(bytes32 => bool) public lockedMatches;
    mapping(bytes32 => uint256) public matchPots;
    mapping(bytes32 => mapping(bytes32 => bool)) private matchEntries;

    address public immutable appTreasury;
    address public operator;

    event AgentRegistered(bytes32 indexed agentId, address treasury, address owner);
    event SkillPurchased(bytes32 indexed agentId, uint8 skillId, uint256 price, uint256 purchaseCount);
    event MatchEntered(bytes32 indexed matchId, bytes32 indexed agentId, uint256 price);
    event MatchSealed(bytes32 indexed matchId, uint256 pot);
    event MatchSettled(bytes32 indexed matchId, bytes32 indexed winnerAgentId, bytes32 combatDigest, uint256 winnerPayout, uint256 treasuryPayout);

    constructor(address _appTreasury, address _operator) {
        if (_appTreasury == address(0)) revert InvalidTreasury();
        appTreasury = _appTreasury;
        operator = _operator;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    function registerAgent(bytes32 agentId, address treasury) external {
        if (treasury == address(0)) revert InvalidTreasury();
        if (agents[agentId].exists) revert AgentAlreadyRegistered();

        agents[agentId] = AgentAccount({
            owner: msg.sender,
            treasury: treasury,
            exists: true
        });

        emit AgentRegistered(agentId, treasury, msg.sender);
    }

    function purchaseSkill(bytes32 agentId, uint8 skillId) external payable {
        if (skillId >= 5) revert InvalidSkillId();

        AgentAccount memory agent = agents[agentId];
        if (!agent.exists) revert AgentNotRegistered();
        if (agent.owner != msg.sender) revert NotAgentOwner();

        uint256 price = quoteSkillPrice(agentId, skillId);
        if (msg.value < price) revert InsufficientPayment();

        skillPurchaseCounts[agentId][skillId] += 1;
        _refundExcess(price);

        emit SkillPurchased(agentId, skillId, price, skillPurchaseCounts[agentId][skillId]);
    }

    function enterMatch(bytes32 matchId, bytes32 agentId) external payable {
        AgentAccount memory agent = agents[agentId];
        if (!agent.exists) revert AgentNotRegistered();
        if (agent.owner != msg.sender) revert NotAgentOwner();
        if (lockedMatches[matchId]) revert MatchLocked();
        if (matchEntries[matchId][agentId]) revert AlreadyEnteredMatch();
        if (msg.value < MATCH_ENTRY_FEE) revert InsufficientPayment();

        matchEntries[matchId][agentId] = true;
        matchPots[matchId] += MATCH_ENTRY_FEE;
        _refundExcess(MATCH_ENTRY_FEE);

        emit MatchEntered(matchId, agentId, MATCH_ENTRY_FEE);
    }

    function lockMatch(bytes32 matchId) external onlyOperator {
        lockedMatches[matchId] = true;
        emit MatchSealed(matchId, matchPots[matchId]);
    }

    function hasEnteredMatch(bytes32 matchId, bytes32 agentId) external view returns (bool) {
        return matchEntries[matchId][agentId];
    }

    function settleMatch(bytes32 matchId, bytes32 winnerAgentId, bytes32 combatDigest) external onlyOperator {
        if (settledMatches[matchId]) revert MatchAlreadySettled();
        if (!lockedMatches[matchId]) revert MatchNotLocked();
        AgentAccount memory winner = agents[winnerAgentId];
        if (!winner.exists) revert AgentNotRegistered();
        if (!matchEntries[matchId][winnerAgentId]) revert WinnerDidNotEnterMatch();
        uint256 matchPot = matchPots[matchId];
        if (matchPot == 0) revert NoEntryPool();

        settledMatches[matchId] = true;
        matchPots[matchId] = 0;

        uint256 winnerPayout = (matchPot * WINNER_SHARE_BPS) / 10000;
        uint256 treasuryPayout = matchPot - winnerPayout;

        (bool sentWinner, ) = winner.treasury.call{value: winnerPayout}("");
        require(sentWinner, "Winner payout failed");

        (bool sentTreasury, ) = appTreasury.call{value: treasuryPayout}("");
        require(sentTreasury, "Treasury payout failed");

        emit MatchSettled(matchId, winnerAgentId, combatDigest, winnerPayout, treasuryPayout);
    }

    function quoteSkillPrice(bytes32 agentId, uint8 skillId) public view returns (uint256) {
        if (!agents[agentId].exists) revert AgentNotRegistered();
        if (skillId >= 5) revert InvalidSkillId();

        uint256 count = skillPurchaseCounts[agentId][skillId];
        if (count < 4) {
            return SKILL_BAND_ONE_PRICE;
        }
        if (count < 10) {
            return SKILL_BAND_TWO_PRICE;
        }
        return SKILL_BAND_THREE_PRICE;
    }

    function getSkillPurchaseCount(bytes32 agentId) external view returns (uint256[5] memory) {
        return skillPurchaseCounts[agentId];
    }

    function setOperator(address newOperator) external onlyOperator {
        operator = newOperator;
    }

    function _refundExcess(uint256 requiredValue) private {
        uint256 refund = msg.value - requiredValue;
        if (refund > 0) {
            (bool sentRefund, ) = msg.sender.call{value: refund}("");
            require(sentRefund, "Refund failed");
        }
    }
}
