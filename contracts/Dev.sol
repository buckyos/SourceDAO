// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./Interface.sol";
import "./SourceDaoUpgradeable.sol";

contract ProjectManagement is
    ISourceDevGroup,
    Initializable,
    SourceDaoContractUpgradeable {
    struct ContributionInfo {
        address contributor;
        uint64 value;
        bool hasClaim;
    }

    struct ProjectDetail {
        ContributionInfo[] contributions;
    }

    mapping(uint => ProjectBrief) private projects;
    mapping(uint => ProjectDetail) private projectDetails;

    uint public projectIdCounter;

    event ChangeTokenAddress(address oldAddress, address newAddress);
    event ChangeCommittee(address oldAddress, address newAddress);
    event WithdrawContributionToken(address owner, uint amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address mainAddr) initializer public {
        __SourceDaoContractUpgradable_init(mainAddr);
        projectIdCounter = 0;
    }

    function createProject(uint budget, uint64 issueId, uint64 startDate, uint64 endDate) external returns(uint ProjectId) {
        ProjectBrief storage project = projects[projectIdCounter];
        project.manager = msg.sender;
        project.budget = budget;
        project.issueId = issueId;
        bytes32[] memory params;
        project.proposalId = getMainContractAddress().committee().propose(2592000, params);
        project.startDate = startDate;
        project.endDate = endDate;
        project.state = ProjectState.Preparing;
        project.result = ProjectResult.Inprogress;

        emit ProjectCreate(projectIdCounter, project.proposalId);

        ProjectId = projectIdCounter;
        projectIdCounter++;
    }

    function promoteProject(uint projectId) external {
        ProjectBrief storage project = projects[projectId];

        require(project.manager != address(0), "This project doesn't exist");
        require(project.manager == msg.sender, "Must be called by the project manager");
        require(project.state == ProjectState.Preparing || project.state == ProjectState.Accepting, "state error");

        ISourceDaoCommittee.ProposalResult result = getMainContractAddress().committee().takeResult(project.proposalId, new bytes32[](0));
        require(result == ISourceDaoCommittee.ProposalResult.Accept, "Proposal status is not accept");

        ProjectState oldState = project.state;
        if (project.state == ProjectState.Preparing) {
            project.state = ProjectState.Developing;
        } else if (project.state == ProjectState.Accepting) {
            project.state = ProjectState.Finished;

            uint coefficient = 0;
            if (project.result == ProjectResult.Excellent) {
                coefficient = 120;
            } else if (project.result == ProjectResult.Good) {
                coefficient = 100;
            } else if (project.result == ProjectResult.Normal) {
                coefficient = 80;
            }
            uint reward = (project.budget * coefficient) / 100;

            getMainContractAddress().token().releaseTokensToSelf(reward);
        }
        getMainContractAddress().committee().setProposalExecuted(project.proposalId);
        emit ProjectChange(projectId, project.proposalId, oldState, project.state);
    }

    function acceptProject(uint projectId, ProjectResult result, Contribution[] calldata contributions) external {
        ProjectBrief storage project = projects[projectId];

        require(project.manager != address(0), "This project doesn't exist");
        require(project.state == ProjectState.Developing, "state error");
        require(project.manager == msg.sender, "Must be called by the project manager");

        project.result = result;

        ProjectDetail storage projectDetail = projectDetails[projectId];
        if (projectDetail.contributions.length != 0) {
            delete projectDetail.contributions;
        }

        for (uint i = 0 ; i < contributions.length; i++) {
            projectDetail.contributions.push(ContributionInfo(contributions[i].contributor, contributions[i].value, false));
        }

        project.state = ProjectState.Accepting;
        project.proposalId = getMainContractAddress().committee().propose(2592000, new bytes32[](0));
        emit ProjectChange(projectId, project.proposalId, ProjectState.Developing, ProjectState.Accepting);
    }

    function updateContribute(uint projectId, Contribution calldata contribution) external {
        ProjectBrief storage project = projects[projectId];
        require(project.manager != address(0), "This project doesn't exist");
        require(project.state == ProjectState.Accepting, "status error");
        require(msg.sender == project.manager, "Must be called by the project manager");

        ProjectDetail storage detail = projectDetails[projectId];
        for (uint i = 0; i < detail.contributions.length; i++) {
            if (detail.contributions[i].contributor == contribution.contributor) {
                detail.contributions[i].value = contribution.value;
                break;
            }
        }
    }

    function withdrawContributions(uint[] calldata projectIds) external returns(uint) {
        uint claimAmount = 0;
        for (uint j = 0; j < projectIds.length; j++) {
            uint projectId = projectIds[j];
            ProjectBrief memory project = projects[projectId];

            require(project.manager != address(0), "This project doesn't exist");
            require(project.state == ProjectState.Finished, "status error");

            uint coefficient = 0;
            if (project.result == ProjectResult.Excellent) {
                coefficient = 120;
            } else if (project.result == ProjectResult.Good) {
                coefficient = 100;
            } else if (project.result == ProjectResult.Normal) {
                coefficient = 80;
            }
            uint reward = (project.budget * coefficient) / 100;
            uint contribution = 0;
            uint totalContribution = 0;
            ProjectDetail storage projectDetail = projectDetails[projectId];
            for (uint i = 0; i < projectDetail.contributions.length; i++) {
                totalContribution += projectDetail.contributions[i].value;
                if (projectDetail.contributions[i].contributor == msg.sender && projectDetail.contributions[i].hasClaim == false) {
                    contribution = projectDetail.contributions[i].value;
                    projectDetail.contributions[i].hasClaim = true;
                }
            }
            claimAmount = claimAmount + reward * contribution / totalContribution;
        }
        IERC20(address(getMainContractAddress().token())).transfer(msg.sender, claimAmount);
        emit WithdrawContributionToken(msg.sender, claimAmount);
        return claimAmount;
    }

    function projectOf(uint projectId) public view returns (ProjectBrief memory) {
        ProjectBrief memory project = projects[projectId];
        return project;
    }

    function contributionOf(uint projectId, address who) external view returns(uint) {
        ProjectDetail memory projectDetail = projectDetails[projectId];
        for (uint i = 0; i < projectDetail.contributions.length; i++) {
            if (projectDetail.contributions[i].contributor == who) {
                return projectDetail.contributions[i].value;
            }
        }
        return 0;
    }
}
