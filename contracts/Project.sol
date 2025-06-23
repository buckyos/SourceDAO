// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./Interface.sol";
import "./SourceDaoUpgradeable.sol";

contract ProjectManagement is
    ISourceProject,
    Initializable,
    SourceDaoContractUpgradeable,
    ReentrancyGuardUpgradeable {
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

    
    mapping(bytes32 => VersionInfo) private projectLatestVersions;

    event ChangeTokenAddress(address oldAddress, address newAddress);
    event ChangeCommittee(address oldAddress, address newAddress);
    event WithdrawContributionToken(address owner, uint amount);
    event WithdrawContributionToken2(address owner, uint amount, uint[] projectIds);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(uint initProjectIdCounter, address mainAddr) initializer public {
        __SourceDaoContractUpgradable_init(mainAddr);
        
        projectIdCounter = initProjectIdCounter;
    }

    function _makeProjectParams(uint projectId, ProjectBrief memory project) pure internal returns (bytes32[] memory) {
        
        bytes32[] memory params = new bytes32[](6);
        params[0] = bytes32(projectId);
        params[1] = project.projectName;
        params[2] = bytes32(uint256(project.version));
        params[3] = bytes32(uint256(project.startDate));
        params[4] = bytes32(uint256(project.endDate));

        if (project.state == ProjectState.Preparing) {
            params[5] = bytes32("createProject");
        } else if (project.state == ProjectState.Accepting) {
            params[5] = bytes32("acceptProject");
        }

        return params;
    }

    function createProject(uint budget, bytes32 name, uint64 version, uint64 startDate, uint64 endDate, address[] calldata extraTokens, uint256[] calldata extraTokenAmunts) external nonReentrant returns(uint ProjectId) {
        require(projectLatestVersions[name].version < version, "Version must be greater than the latest version");

        // budget不能超过devToken总量的2.5%
        require(budget <= getMainContractAddress().devToken().totalSupply() * 25 / 1000, "Budget exceeds 2.5% of total supply");
        // 每个版本之间最少间隔7天
        require(block.timestamp - projectLatestVersions[name].versionTime > 7 days, "Project version must be at least 7 days apart");

        uint projectId = projectIdCounter++;
        ProjectBrief storage project = projects[projectId];
        project.manager = msg.sender;
        project.budget = budget;
        project.projectName = name;
        project.version = version;
        project.startDate = startDate;
        project.endDate = endDate;
        project.extraTokens = extraTokens;
        project.extraTokenAmounts = extraTokenAmunts;
        project.state = ProjectState.Preparing;
        project.result = ProjectResult.InProgress;

        bytes32[] memory params = _makeProjectParams(projectId, project);

        project.proposalId = getMainContractAddress().committee().propose(30 days, params);

        for (uint i = 0; i < extraTokens.length; i++) {
            IERC20(extraTokens[i]).transferFrom(msg.sender, address(this), extraTokenAmunts[i]);
        }

        emit ProjectCreate(projectId, project.proposalId);

        return projectId;
    }

    function cancelProject(uint projectId) external nonReentrant {
        ProjectBrief storage project = projects[projectId];

        require(project.manager != address(0), "This project doesn't exist");
        require(project.manager == msg.sender, "Must be called by the project manager");

        // preparing状态下提案被拒绝，说明项目本身没有被接受
        // accept状态下提案被拒绝，说明项目本身的开发失败
        require(project.state == ProjectState.Preparing || project.state == ProjectState.Accepting, "state error");

        bytes32[] memory params = _makeProjectParams(projectId, project);
        ISourceDaoCommittee.ProposalResult result = getMainContractAddress().committee().takeResult(project.proposalId, params);
        require(result == ISourceDaoCommittee.ProposalResult.Reject || result == ISourceDaoCommittee.ProposalResult.Expired, "Proposal status is not failed");

        project.state = ProjectState.Rejected;
        for (uint i = 0; i < project.extraTokens.length; i++) {
            IERC20(project.extraTokens[i]).transfer(project.manager, project.extraTokenAmounts[i]);
        }
    }

    function promoteProject(uint projectId) external nonReentrant {
        ProjectBrief storage project = projects[projectId];

        require(project.manager != address(0), "This project doesn't exist");
        require(project.manager == msg.sender, "Must be called by the project manager");
        require(project.state == ProjectState.Preparing || project.state == ProjectState.Accepting, "state error");

        bytes32[] memory params = _makeProjectParams(projectId, project);
        ISourceDaoCommittee.ProposalResult result = getMainContractAddress().committee().takeResult(project.proposalId, params);
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

            getMainContractAddress().devToken().mintDevToken(reward);

            // set project version to latest
            // 会不会有这种情况？当前是0.0.1， 同时有0.0.2和0.0.3在开发，0.0.3先完成，0.0.2后完成？
            if (projectLatestVersions[project.projectName].version < project.version) {
                projectLatestVersions[project.projectName].version = project.version;
                projectLatestVersions[project.projectName].versionTime = block.timestamp;
            }

            // 如果coefficient不是100，在这里把多余的部分还给项目manager
            if (coefficient < 100) {
                for (uint i = 0; i < project.extraTokens.length; i++) {
                    uint extraTokenAmount = project.extraTokenAmounts[i] * (coefficient - 100) / 100;
                    IERC20(project.extraTokens[i]).transfer(project.manager, extraTokenAmount);
                }
            }
            
        }
        getMainContractAddress().committee().setProposalExecuted(project.proposalId);
        emit ProjectChange(projectId, project.proposalId, oldState, project.state);
    }

    function acceptProject(uint projectId, ProjectResult result, Contribution[] calldata contributions) external nonReentrant {
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
        bytes32[] memory params = _makeProjectParams(projectId, project);
        project.proposalId = getMainContractAddress().committee().propose(30 days, params);
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

    function withdrawContributions(uint[] calldata projectIds) external nonReentrant returns(uint) {
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

            // 处理extra token
            uint extraCoefficient = coefficient;
            // extra最多只能拿到100%
            if (extraCoefficient > 100) {
                extraCoefficient = 100;
            }
            for (uint i = 0; i < project.extraTokens.length; i++) {
                // extraCoefficient / 100计算extra能拿到的总比例
                // contribution / totalContribution计算这个人能拿到多少
                uint extraTokenAmount = project.extraTokenAmounts[i] * extraCoefficient / 100 * contribution / totalContribution ;
                IERC20(project.extraTokens[i]).transfer(msg.sender, extraTokenAmount);
            }
        }
        IERC20(address(getMainContractAddress().devToken())).transfer(msg.sender, claimAmount);
        emit WithdrawContributionToken2(msg.sender, claimAmount, projectIds);
        return claimAmount;
    }

    function projectOf(uint projectId) public view returns (ProjectBrief memory) {
        ProjectBrief memory project = projects[projectId];
        return project;
    }

    function projectDetailOf(uint projectId) public view returns(ProjectDetail memory) {
        return projectDetails[projectId];
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

    function latestProjectVersion(bytes32 projectName) external view returns(VersionInfo memory) {
        return projectLatestVersions[projectName];
    }

    function versionReleasedTime(bytes32 projectName, uint64 version) external view returns(uint256) {
        VersionInfo memory versionInfo = projectLatestVersions[projectName];
        if (versionInfo.version >= version) {
            return versionInfo.versionTime;
        }
        return 0;
    }
}
